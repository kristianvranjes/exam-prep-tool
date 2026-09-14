from functools import lru_cache

from app.config import Settings
from app.services.embeddings.base import EmbeddingProvider
from app.services.embeddings.bge_m3 import BGEM3Provider


@lru_cache(maxsize=1)
def _provider(model: str, revision: str, max_tokens: int, batch_size: int) -> BGEM3Provider:
    return BGEM3Provider(model, revision, max_tokens, batch_size)


def get_embedding_provider() -> EmbeddingProvider:
    settings = Settings()
    return _provider(
        settings.embedding_model,
        settings.embedding_revision,
        settings.embedding_max_tokens,
        settings.embedding_batch_size,
    )
