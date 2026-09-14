from app.config import Settings
from app.services.ai.base import AIProvider
from app.services.ai.providers.freellmapi import FreeLLMAPIProvider
from app.services.ai.providers.ollama import OllamaProvider


def get_ai_provider() -> AIProvider:
    settings = Settings()
    if settings.ai_provider == "freellmapi":
        return FreeLLMAPIProvider(
            settings.freellmapi_url,
            settings.freellmapi_model,
            settings.freellmapi_api_key,
            settings.ai_request_timeout_seconds,
        )
    return OllamaProvider(
        settings.ollama_url, settings.ollama_model, settings.ai_request_timeout_seconds
    )
