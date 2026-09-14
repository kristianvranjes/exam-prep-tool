from pydantic import ValidationError

from app.services.ai.base import AIError, AIProvider, Generation, T


def generate_validated(
    provider: AIProvider, system_prompt: str, user_prompt: str, response_model: type[T]
) -> tuple[T, Generation]:
    try:
        generation = provider.generate_structured(system_prompt, user_prompt, response_model)
        return response_model.model_validate_json(generation.content), generation
    except ValidationError:
        raise AIError("INVALID_OUTPUT") from None
    except AIError:
        raise
    except Exception:
        raise AIError("PROVIDER_FAILURE") from None
