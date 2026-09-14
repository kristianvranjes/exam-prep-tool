from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Concept(Base):
    __tablename__ = "concepts"
    __table_args__ = (
        UniqueConstraint("course_id", "normalized_name", name="uq_concept_course_name"),
        CheckConstraint("status IN ('DRAFT','APPROVED','REJECTED')", name="ck_concept_status"),
        CheckConstraint("created_by IN ('AI','USER')", name="ck_concept_creator"),
        CheckConstraint("importance IN ('LOW','MEDIUM','HIGH')", name="ck_concept_importance"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    course_id: Mapped[UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    normalized_name: Mapped[str] = mapped_column(String(600))
    description: Mapped[str | None] = mapped_column(Text)
    aliases: Mapped[list[str]] = mapped_column(JSONB, default=list)
    importance: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(10), default="DRAFT")
    created_by: Mapped[str] = mapped_column(String(10), default="AI")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ConceptChunk(Base):
    __tablename__ = "concept_chunks"
    concept_id: Mapped[UUID] = mapped_column(
        ForeignKey("concepts.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    material_chunk_id: Mapped[UUID] = mapped_column(
        ForeignKey("material_chunks.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
