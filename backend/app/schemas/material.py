from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.models.material import MaterialStatus


class MaterialResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    course_id: UUID
    uploaded_by_user_id: UUID
    original_filename: str
    media_type: str
    file_size_bytes: int
    status: MaterialStatus
    processing_error: str | None
    created_at: datetime
    updated_at: datetime


class SectionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ordinal: int
    title: str | None
    level: int | None
    content: str


class MaterialDetail(MaterialResponse):
    extracted_markdown: str | None
    sections: list[SectionResponse]
    chunk_count: int


class ChunkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    material_id: UUID
    section_id: UUID | None
    ordinal: int
    content: str
    char_count: int
