from datetime import datetime
from uuid import UUID, uuid4

from pgvector.sqlalchemy import VECTOR
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.config import EMBEDDING_DIMENSION
from app.database import Base


class MaterialChunk(Base):
    __tablename__ = "material_chunks"
    __table_args__ = (
        CheckConstraint(
            "(embedding IS NULL AND embedding_content_hash IS NULL "
            "AND embedding_signature IS NULL AND embedded_at IS NULL) OR "
            "(embedding IS NOT NULL AND embedding_content_hash IS NOT NULL "
            "AND embedding_signature IS NOT NULL AND embedded_at IS NOT NULL "
            "AND length(embedding_content_hash) = 64 AND length(embedding_signature) = 64 "
            "AND vector_norm(embedding) > 0)",
            name="ck_chunk_embedding_complete",
        ),
        UniqueConstraint("material_id", "ordinal", name="uq_material_chunk_ordinal"),
        CheckConstraint("ordinal >= 0", name="ck_chunk_ordinal"),
        CheckConstraint(
            "char_count > 0 AND char_count = char_length(content)", name="ck_chunk_length"
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    material_id: Mapped[UUID] = mapped_column(
        ForeignKey("materials.id", ondelete="CASCADE"), index=True
    )
    section_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("material_sections.id", ondelete="CASCADE")
    )
    ordinal: Mapped[int]
    content: Mapped[str] = mapped_column(Text)
    char_count: Mapped[int]
    embedding: Mapped[list[float] | None] = mapped_column(
        VECTOR(EMBEDDING_DIMENSION), deferred=True
    )
    embedding_content_hash: Mapped[str | None] = mapped_column(String(64))
    embedding_signature: Mapped[str | None] = mapped_column(String(64))
    embedded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
