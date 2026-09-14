import ipaddress
import re
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, Field, SecretStr, ValidationError

from app.services.ai.base import AIError, Generation, T


class Message(BaseModel):
    content: str


class Choice(BaseModel):
    message: Message
    finish_reason: str | None = None


class Usage(BaseModel):
    prompt_tokens: int | None = Field(default=None, ge=0, strict=True)
    completion_tokens: int | None = Field(default=None, ge=0, strict=True)
    total_tokens: int | None = Field(default=None, ge=0, strict=True)


class Completion(BaseModel):
    choices: list[Choice] = Field(min_length=1)
    usage: Usage | None = None


def validate_url(url: str) -> str:
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    local = host in {"localhost", "host.docker.internal", "freellmapi"}
    try:
        address = ipaddress.ip_address(host)
        local = address.is_loopback or any(
            address in network
            for network in (
                ipaddress.ip_network("10.0.0.0/8"),
                ipaddress.ip_network("172.16.0.0/12"),
                ipaddress.ip_network("192.168.0.0/16"),
            )
            if address.version == network.version
        )
    except ValueError:
        pass
    if (
        not local
        or parsed.scheme != "http"
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path.rstrip("/") != "/v1"
    ):
        raise AIError("INVALID_CONFIGURATION")
    return url.rstrip("/")


def routed_metadata(header: str | None, key: str) -> tuple[str | None, str | None]:
    # Never persist arbitrary response headers, URLs, or reflected credentials.
    if (
        not header
        or key in header
        or not re.fullmatch(r"[A-Za-z0-9_.:-]+/[A-Za-z0-9_./:-]+", header)
    ):
        return None, None
    provider, model = header.split("/", 1)
    if len(provider) > 50 or len(model) > 200 or "://" in header:
        return None, None
    return provider, model


class FreeLLMAPIProvider:
    name = "freellmapi"

    def __init__(self, url: str, model: str, api_key: SecretStr, timeout: float):
        self.url = url
        self.model = model
        self.api_key = api_key
        self.timeout = timeout

    def generate_structured(
        self, system_prompt: str, user_prompt: str, response_model: type[T]
    ) -> Generation:
        try:
            base = validate_url(self.url)
            key = self.api_key.get_secret_value()
            if not key.strip() or not self.model.strip():
                raise AIError("INVALID_CONFIGURATION")
            with httpx.Client(
                timeout=self.timeout, trust_env=False, follow_redirects=False
            ) as client:
                response = client.post(
                    base + "/chat/completions",
                    headers={
                        "Authorization": f"Bearer {key}",
                    },
                    json={
                        "model": self.model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt},
                        ],
                        "stream": False,
                        "temperature": 0,
                        "max_tokens": 2048,
                        # The shared prompt already contains the schema. Do not repeat it.
                        "response_format": {"type": "json_object"},
                    },
                )
                response.raise_for_status()
                result = Completion.model_validate(response.json())
                choice = result.choices[0]
                if choice.finish_reason not in (None, "stop"):
                    raise AIError("INVALID_OUTPUT")
                usage = result.usage or Usage()
                routed_provider, routed_model = routed_metadata(
                    response.headers.get("X-Routed-Via"), key
                )
                return Generation(
                    content=choice.message.content,
                    prompt_tokens=usage.prompt_tokens,
                    completion_tokens=usage.completion_tokens,
                    total_tokens=usage.total_tokens,
                    routed_provider=routed_provider,
                    routed_model=routed_model,
                )
        except AIError:
            raise
        except httpx.TimeoutException:
            raise AIError("TIMEOUT") from None
        except httpx.HTTPError:
            raise AIError("UNAVAILABLE") from None
        except (ValidationError, ValueError):
            raise AIError("INVALID_OUTPUT") from None
        except Exception:
            raise AIError("PROVIDER_FAILURE") from None
