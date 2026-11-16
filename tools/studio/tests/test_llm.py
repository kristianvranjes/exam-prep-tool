import json
from pathlib import Path

import httpx
import pytest
from pydantic import BaseModel, ConfigDict

from studio.config import Provider, Stage, StudioError
from studio.llm import ChatClient, LLMError

KEY = "sk-or-test-key-1234567890"
VALID = '{"ready": true, "language": "hr"}'


class Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ready: bool
    language: str


def completion(content: str, finish: str = "stop") -> dict[str, object]:
    return {
        "model": "qwen/qwen3.8-flash",
        "provider": "Alibaba",
        "choices": [{"message": {"content": content}, "finish_reason": finish}],
        "usage": {"prompt_tokens": 40, "completion_tokens": 9, "total_tokens": 49, "cost": 1e-05},
    }


def client(
    transport: httpx.MockTransport,
    tmp_path: Path,
    *,
    base_url: str = "https://openrouter.ai/api/v1",
    env: dict[str, str] | None = None,
    **stage: object,
) -> ChatClient:
    settings = {"provider": "openrouter", "model": "qwen/qwen3.8-flash"} | stage
    return ChatClient(
        stage_name="verify",
        provider_name="openrouter",
        provider=Provider(base_url=base_url, api_key_env="OPENROUTER_API_KEY"),
        stage=Stage.model_validate(settings),
        log_path=tmp_path / "calls.jsonl",
        env={"OPENROUTER_API_KEY": KEY} if env is None else env,
        transport=transport,
    )


def ask(c: ChatClient) -> Answer:
    return c.complete_json(system="s", user="u", response_model=Answer, prompt_version="ping-v1")


def records(tmp_path: Path) -> list[dict[str, object]]:
    lines = (tmp_path / "calls.jsonl").read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines]


def test_request_asks_for_strict_schema_and_records_the_call(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=completion(VALID))

    assert ask(client(httpx.MockTransport(handle), tmp_path)) == Answer(ready=True, language="hr")
    request = seen[0]
    assert request.url == "https://openrouter.ai/api/v1/chat/completions"
    assert request.headers["Authorization"] == f"Bearer {KEY}"
    body = json.loads(request.content)
    assert body["temperature"] == 0 and body["stream"] is False
    assert body["response_format"]["json_schema"]["strict"] is True
    assert body["response_format"]["json_schema"]["schema"]["additionalProperties"] is False
    assert body["provider"] == {"require_parameters": True}

    [record] = records(tmp_path)
    assert record["ok"] is True and record["error"] is None
    assert record["routed_model"] == "qwen/qwen3.8-flash"
    assert record["routed_provider"] == "Alibaba"
    assert (record["prompt_tokens"], record["total_tokens"], record["cost_usd"]) == (40, 49, 1e-05)
    assert KEY not in (tmp_path / "calls.jsonl").read_text(encoding="utf-8")


def test_vendor_endpoints_get_no_openrouter_routing_options(tmp_path: Path) -> None:
    bodies: list[dict[str, object]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json=completion(f"```json\n{VALID}\n```"))

    c = client(httpx.MockTransport(handle), tmp_path, base_url="https://api.deepseek.com/v1")
    assert ask(c).language == "hr"  # a fenced JSON block is accepted
    assert "provider" not in bodies[0]


REFLECTED = json.dumps({"ready": True, "language": KEY})


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (httpx.Response(429, json={"error": {"message": f"slow down {KEY}"}}), "RATE_LIMITED"),
        (httpx.Response(402, json={"error": {"message": "no credits"}}), "PAYMENT_REQUIRED"),
        (httpx.Response(200, json={"error": {"message": "upstream"}}), "UPSTREAM_ERROR"),
        (httpx.Response(200, json=completion('{"ready": tr', finish="length")), "TRUNCATED"),
        (httpx.Response(200, json=completion("not json")), "INVALID_JSON"),
        (httpx.Response(200, json=completion('{"ready": true}')), "SCHEMA_MISMATCH"),
        (httpx.Response(200, json=completion(REFLECTED)), "KEY_REFLECTED"),
        (httpx.Response(200, json={"choices": []}), "MALFORMED_RESPONSE"),
        (httpx.Response(200, json=completion("")), "EMPTY_RESPONSE"),
    ],
)
def test_failures_raise_a_code_and_are_logged(
    tmp_path: Path, response: httpx.Response, code: str
) -> None:
    c = client(httpx.MockTransport(lambda request: response), tmp_path)
    with pytest.raises(LLMError) as raised:
        ask(c)
    assert raised.value.code == code
    assert KEY not in str(raised.value)
    [record] = records(tmp_path)
    assert record["ok"] is False and record["error"] == code


def test_timeouts_have_a_code(tmp_path: Path) -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(LLMError) as raised:
        ask(client(httpx.MockTransport(timeout), tmp_path))
    assert raised.value.code == "TIMEOUT"


def test_missing_key_is_reported_before_any_request(tmp_path: Path) -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request expected")

    with pytest.raises(StudioError, match="OPENROUTER_API_KEY is not set"):
        ask(client(httpx.MockTransport(fail), tmp_path, env={}))
    assert not (tmp_path / "calls.jsonl").exists()


def test_calls_within_a_stage_are_spaced(tmp_path: Path) -> None:
    now = [100.0]
    slept: list[float] = []

    def handle(request: httpx.Request) -> httpx.Response:
        now[0] += 0.25  # each call takes 250 ms
        return httpx.Response(200, json=completion(VALID))

    c = client(httpx.MockTransport(handle), tmp_path, min_interval_seconds=1.0)
    c.clock = lambda: now[0]
    c.sleep = slept.append
    ask(c)
    now[0] += 0.4
    ask(c)
    assert slept == [pytest.approx(0.6)]
    assert [r["latency_ms"] for r in records(tmp_path)] == [250, 250]


def test_openrouter_requests_skip_the_configured_providers(tmp_path: Path) -> None:
    bodies: list[dict[str, object]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json=completion(VALID))

    ask(client(httpx.MockTransport(handle), tmp_path, ignore_providers=["Crusoe"]))
    assert bodies[0]["provider"] == {"require_parameters": True, "ignore": ["Crusoe"]}
