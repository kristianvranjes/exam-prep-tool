from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
    top_k: int = Field(default=5, ge=1, le=20)


class SearchHit(BaseModel):
    material_id: UUID
    chunk_id: UUID
    ordinal: int
    content: str
    distance: float
    similarity: float


class EmbeddingResult(BaseModel):
    material_id: UUID
    embedded: int
    skipped: int
    signature: str
