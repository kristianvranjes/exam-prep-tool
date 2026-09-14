from app.config import Settings
from app.services.ai.base import AIProvider
from app.services.ai.providers.ollama import OllamaProvider


def get_ai_provider() -> AIProvider:
    settings = Settings()
    return OllamaProvider(
        settings.ollama_url, settings.ollama_model, settings.ai_request_timeout_seconds
    )
