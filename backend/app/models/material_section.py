from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MaterialSection(Base):
    __tablename__ = "material_sections"
    __table_args__ = (
        UniqueConstraint("material_id", "ordinal", name="uq_material_section_ordinal"),
        CheckConstraint("ordinal >= 0", name="ck_section_ordinal"),
        CheckConstraint("level IS NULL OR level BETWEEN 1 AND 6", name="ck_section_level"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    material_id: Mapped[UUID] = mapped_column(
        ForeignKey("materials.id", ondelete="CASCADE"), index=True
    )
    ordinal: Mapped[int]
    title: Mapped[str | None] = mapped_column(Text)
    level: Mapped[int | None]
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
