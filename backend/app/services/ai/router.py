from fastapi import HTTPException

from app.config import Settings
from app.services.ai.base import AIProvider
from app.services.ai.providers.freellmapi import FreeLLMAPIProvider
from app.services.ai.providers.ollama import OllamaProvider
from app.services.ai.providers.openai_compatible import OpenAICompatibleProvider


def get_ai_provider() -> AIProvider:
    settings = Settings()
    if settings.ai_provider == "disabled":
        raise HTTPException(503, "Internal AI is disabled; import external quiz drafts instead")
    if settings.ai_provider == "openai_compatible":
        return OpenAICompatibleProvider(
            settings.openai_compatible_url,
            settings.openai_compatible_model,
            settings.openai_compatible_api_key,
            settings.ai_request_timeout_seconds,
        )
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
