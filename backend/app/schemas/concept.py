from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Description = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
]
Importance = Literal["LOW", "MEDIUM", "HIGH"]
ConceptStatus = Literal["DRAFT", "APPROVED", "REJECTED"]


class ExtractedConcept(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: Name
    description: Description
    aliases: list[Name] = Field(max_length=10)
    importance: Importance
    source_chunk_ordinals: list[Annotated[int, Field(ge=0)]] = Field(min_length=1, max_length=32)


class ConceptExtractionResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    concepts: list[ExtractedConcept] = Field(max_length=30)


class ConceptResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    course_id: UUID
    name: str
    normalized_name: str
    description: str | None
    aliases: list[str]
    importance: Importance
    status: ConceptStatus
    created_by: str
    created_at: datetime
    updated_at: datetime


class SourceChunk(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    material_id: UUID
    ordinal: int
    content: str


class ConceptDetail(ConceptResponse):
    source_chunks: list[SourceChunk]


class ReviewRequest(BaseModel):
    status: Literal["APPROVED", "REJECTED"]


class UsageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    batch_ordinal: int
    provider: str
    model: str
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    latency_ms: int | None
    estimated_cost: Decimal | None


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    course_id: UUID
    material_id: UUID | None
    requested_by_user_id: UUID
    operation: str
    provider: str
    model: str
    prompt_version: str
    status: str
    error_message: str | None
    error_code: str | None
    input_chunk_count: int
    input_char_count: int
    input_chunk_ids: list[str]
    input_concept_ids: list[str]
    batch_count: int
    started_at: datetime
    completed_at: datetime | None
    created_at: datetime


class JobDetail(JobResponse):
    usage: list[UsageResponse]
