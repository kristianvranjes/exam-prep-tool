import ipaddress
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.services.ai.base import AIError, Generation, T


class Message(BaseModel):
    content: str


class ChatResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    message: Message
    done: bool
    prompt_eval_count: int | None = Field(default=None, ge=0)
    eval_count: int | None = Field(default=None, ge=0)


def validate_local_url(url: str) -> str:
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    allowed = host in {"localhost", "host.docker.internal", "ollama"}
    try:
        address = ipaddress.ip_address(host)
        allowed = address.is_loopback or any(
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
        not allowed
        or parsed.scheme != "http"
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise AIError("INVALID_CONFIGURATION")
    return url.rstrip("/")


class OllamaProvider:
    name = "ollama"

    def __init__(self, url: str, model: str, timeout: float):
        self.url = url
        self.model = model
        self.timeout = timeout

    def generate_structured(
        self, system_prompt: str, user_prompt: str, response_model: type[T]
    ) -> Generation:
        base = validate_local_url(self.url)
        if not self.model or "cloud" in self.model.casefold():
            raise AIError("INVALID_CONFIGURATION")
        try:
            with httpx.Client(
                timeout=self.timeout, trust_env=False, follow_redirects=False
            ) as client:
                response = client.post(
                    base + "/api/chat",
                    json={
                        "model": self.model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt},
                        ],
                        "format": response_model.model_json_schema(),
                        "stream": False,
                        "think": False,
                        "options": {"temperature": 0, "seed": 0, "num_predict": 2048},
                    },
                )
                response.raise_for_status()
                payload = ChatResponse.model_validate(response.json())
                if not payload.done:
                    raise AIError("INVALID_OUTPUT")
                return Generation(
                    payload.message.content, payload.prompt_eval_count, payload.eval_count
                )
        except httpx.TimeoutException:
            raise AIError("TIMEOUT") from None
        except httpx.HTTPError:
            raise AIError("UNAVAILABLE") from None
        except (ValidationError, ValueError):
            raise AIError("INVALID_OUTPUT") from None
