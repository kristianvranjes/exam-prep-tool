"""OpenAI-compatible chat client returning Pydantic-validated JSON.

Mirrors the application's `openai_compatible` adapter: strict `json_schema` output,
temperature 0, no environment proxies or redirects, and on OpenRouter
`provider.require_parameters` so requests are not routed to a backend that silently
ignores the schema. There are no automatic retries; a failed call is recorded and the
stage can be rerun. Every call, successful or not, appends one line to
`build/calls.jsonl` with provider, model, prompt version, latency and token counts,
never the key or prompt text.
"""

import json
import os
import re
import time
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import TypeVar
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from studio.config import Provider, Stage, StudioError

T = TypeVar("T", bound=BaseModel)
IDENTIFIER = re.compile(r"^[A-Za-z0-9_.:/@~ -]{1,120}$")


class LLMError(StudioError):
    def __init__(self, code: str, detail: str = "") -> None:
        self.code = code
        super().__init__(f"{code}: {detail}" if detail else code)


class CallRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    at: str
    stage: str
    provider: str
    model: str
    routed_model: str | None = None
    routed_provider: str | None = None
    prompt_version: str
    ok: bool
    error: str | None = None
    latency_ms: int
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    cost_usd: float | None = None


class _Usage(BaseModel):
    prompt_tokens: int | None = Field(default=None, ge=0)
    completion_tokens: int | None = Field(default=None, ge=0)
    total_tokens: int | None = Field(default=None, ge=0)
    cost: float | None = Field(default=None, ge=0)


def _identifier(value: object, key: str) -> str | None:
    if isinstance(value, str) and IDENTIFIER.fullmatch(value) and key not in value:
        return value
    return None


def _strip_fence(content: str) -> str:
    match = re.fullmatch(r"\s*```(?:json)?\s*(.*?)\s*```\s*", content, re.DOTALL)
    return match.group(1) if match else content


def _status_code(status: int) -> str:
    return {
        401: "AUTH_FAILED",
        402: "PAYMENT_REQUIRED",
        403: "FORBIDDEN",
        404: "NO_COMPATIBLE_ENDPOINT",
        408: "TIMEOUT",
        429: "RATE_LIMITED",
    }.get(status, f"HTTP_{status}")


class ChatClient:
    def __init__(
        self,
        *,
        stage_name: str,
        provider_name: str,
        provider: Provider,
        stage: Stage,
        log_path: Path | None,
        env: Mapping[str, str] = os.environ,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.stage_name = stage_name
        self.provider_name = provider_name
        self.provider = provider
        self.stage = stage
        self.log_path = log_path
        self.env = env
        self.transport = transport
        self.clock = clock
        self.sleep = sleep
        self._last_call: float | None = None

    def _key(self) -> str:
        key = self.env.get(self.provider.api_key_env, "").strip()
        if not key:
            raise StudioError(
                f"environment variable {self.provider.api_key_env} is not set "
                f"(provider {self.provider_name!r})"
            )
        return key

    def _pace(self) -> None:
        if self._last_call is not None:
            wait = self.stage.min_interval_seconds - (self.clock() - self._last_call)
            if wait > 0:
                self.sleep(wait)

    def _body(self, system: str, user: str, response_model: type[BaseModel]) -> dict[str, object]:
        body: dict[str, object] = {
            "model": self.stage.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "temperature": 0,
            "max_tokens": self.stage.max_output_tokens,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": response_model.__name__,
                    "strict": True,
                    "schema": response_model.model_json_schema(),
                },
            },
        }
        if urlsplit(self.provider.base_url).hostname == "openrouter.ai":
            body["provider"] = {"require_parameters": True}
        return body

    def complete_json(
        self, *, system: str, user: str, response_model: type[T], prompt_version: str
    ) -> T:
        key = self._key()
        self._pace()
        started = self.clock()
        record = CallRecord(
            at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            stage=self.stage_name,
            provider=self.provider_name,
            model=self.stage.model,
            prompt_version=prompt_version,
            ok=False,
            latency_ms=0,
        )
        try:
            result = self._call(key, system, user, response_model, record)
            record.ok = True
            return result
        except LLMError as exc:
            record.error = exc.code
            raise
        finally:
            self._last_call = self.clock()
            record.latency_ms = round((self._last_call - started) * 1000)
            self._log(record)

    def _call(
        self, key: str, system: str, user: str, response_model: type[T], record: CallRecord
    ) -> T:
        try:
            with httpx.Client(
                transport=self.transport,
                timeout=self.stage.timeout_seconds,
                trust_env=False,
                follow_redirects=False,
            ) as client:
                response = client.post(
                    self.provider.base_url + "/chat/completions",
                    headers={"Authorization": f"Bearer {key}", "X-Title": "ExamPrep studio"},
                    json=self._body(system, user, response_model),
                )
        except httpx.TimeoutException:
            raise LLMError("TIMEOUT") from None
        except httpx.HTTPError:
            raise LLMError("NETWORK") from None

        try:
            data = response.json()
        except ValueError:
            data = None
        if response.status_code != 200 or not isinstance(data, dict):
            raise LLMError(_status_code(response.status_code), self._provider_message(data, key))
        if "error" in data:
            # OpenRouter can report an upstream failure inside a 200 response.
            raise LLMError("UPSTREAM_ERROR", self._provider_message(data, key))

        record.routed_model = _identifier(data.get("model"), key)
        record.routed_provider = _identifier(data.get("provider"), key)
        try:
            usage = _Usage.model_validate(data.get("usage") or {})
        except ValidationError:
            usage = _Usage()
        record.prompt_tokens = usage.prompt_tokens
        record.completion_tokens = usage.completion_tokens
        record.total_tokens = usage.total_tokens
        record.cost_usd = usage.cost

        choices = data.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise LLMError("MALFORMED_RESPONSE")
        choice = choices[0]
        message = choice.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if choice.get("finish_reason") == "length":
            raise LLMError("TRUNCATED", "raise max_output_tokens or ask for less")
        if not isinstance(content, str) or not content.strip():
            raise LLMError("EMPTY_RESPONSE")
        if key in content:
            raise LLMError("KEY_REFLECTED")
        try:
            return response_model.model_validate_json(_strip_fence(content))
        except ValidationError as exc:
            invalid_json = any(e["type"] == "json_invalid" for e in exc.errors())
            raise LLMError("INVALID_JSON" if invalid_json else "SCHEMA_MISMATCH") from None

    @staticmethod
    def _provider_message(data: object, key: str) -> str:
        error = data.get("error") if isinstance(data, dict) else None
        message = error.get("message") if isinstance(error, dict) else None
        if not isinstance(message, str):
            return ""
        return " ".join(message.replace(key, "***").split())[:240]

    def _log(self, record: CallRecord) -> None:
        if self.log_path is None:
            return
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record.model_dump(), ensure_ascii=False) + "\n")


def calls_log(studio_dir: Path) -> Path:
    return studio_dir / "build" / "calls.jsonl"
