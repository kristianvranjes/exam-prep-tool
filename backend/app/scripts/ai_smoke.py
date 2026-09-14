"""Optional real local provider check: python -m app.scripts.ai_smoke."""

from uuid import UUID

from app.schemas.concept import ConceptExtractionResult
from app.services.ai.base import AIError
from app.services.ai.prompts.concepts import SYSTEM_PROMPT, ChunkInput, user_prompt
from app.services.ai.router import get_ai_provider
from app.services.ai.service import generate_validated


def main() -> None:
    provider = get_ai_provider()
    chunks = [
        ChunkInput(
            UUID(int=1),
            0,
            "Matrica je pravokutna tablica brojeva. Linearna algebra proučava vektore i matrice.",
        )
    ]
    try:
        result, usage = generate_validated(
            provider, SYSTEM_PROMPT, user_prompt(chunks), ConceptExtractionResult
        )
        if not result.concepts or any(set(c.source_chunk_ordinals) != {0} for c in result.concepts):
            raise AIError("INVALID_PROVENANCE")
    except AIError as exc:
        raise SystemExit(f"Local smoke failed: {exc.code}") from None
    print(f"Provider: {provider.name}; model: {provider.model}")
    print(result.model_dump_json(indent=2))
    print(f"Measured tokens: input={usage.prompt_tokens}, output={usage.completion_tokens}")


if __name__ == "__main__":
    main()
