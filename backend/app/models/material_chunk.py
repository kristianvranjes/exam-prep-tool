from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MaterialChunk(Base):
    __tablename__ = "material_chunks"
    __table_args__ = (
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
