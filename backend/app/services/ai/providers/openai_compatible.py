import ipaddress
from urllib.parse import urlsplit

from app.services.ai.base import AIError
from app.services.ai.providers.freellmapi import FreeLLMAPIProvider


def validate_https_url(url: str) -> str:
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    path = parsed.path.rstrip("/")
    if (
        parsed.scheme != "https"
        or not host
        or "." not in host
        or host.endswith((".localhost", ".local", ".internal"))
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or not path.startswith("/")
        or path.split("/")[-1] != "v1"
        or parsed.port not in (None, 443)
    ):
        raise ValueError("AI endpoint must be an explicit public HTTPS URL ending in /v1")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if not address.is_global:
            raise ValueError("AI endpoint must not use a private address")
    return url.rstrip("/")


class OpenAICompatibleProvider(FreeLLMAPIProvider):
    """Reuse the tested wire protocol; staging changes only endpoint policy/name."""

    name = "openai_compatible"

    def validated_url(self) -> str:
        try:
            return validate_https_url(self.url)
        except ValueError:
            raise AIError("INVALID_CONFIGURATION") from None
