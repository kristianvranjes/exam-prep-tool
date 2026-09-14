import math
from hashlib import sha256
from typing import Protocol

from app.config import EMBEDDING_DIMENSION


class EmbeddingError(Exception):
    """Only stable codes cross the embedding boundary."""


class EmbeddingProvider(Protocol):
    signature: str

    def embed(self, texts: list[str]) -> list[list[float]]: ...


def content_hash(content: str) -> str:
    return sha256(content.encode("utf-8")).hexdigest()


def embed_validated(provider: EmbeddingProvider, texts: list[str]) -> list[list[float]]:
    try:
        vectors = provider.embed(texts)
    except EmbeddingError:
        raise
    except Exception:
        raise EmbeddingError("UNAVAILABLE") from None
    try:
        if len(vectors) != len(texts):
            raise ValueError
        result = []
        for vector in vectors:
            if len(vector) != EMBEDDING_DIMENSION or any(
                isinstance(v, bool)
                or not isinstance(v, (int, float))
                or not math.isfinite(v)
                or abs(v) > 3.4028235e38
                for v in vector
            ):
                raise ValueError
            norm = math.hypot(*vector)
            if norm == 0:
                raise ValueError
            result.append([float(v / norm) for v in vector])
        return result
    except Exception:
        raise EmbeddingError("INVALID_VECTOR") from None
