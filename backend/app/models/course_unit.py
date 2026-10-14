from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CourseUnit(Base):
    """An ordered course unit (cjelina); exam scopes and filters build on these."""

    __tablename__ = "course_units"
    __table_args__ = (
        # Deferred so a reorder can swap positions inside one transaction.
        UniqueConstraint(
            "course_id",
            "position",
            name="uq_course_unit_position",
            deferrable=True,
            initially="DEFERRED",
        ),
        UniqueConstraint("course_id", "normalized_title", name="uq_course_unit_title"),
        CheckConstraint("position >= 0", name="ck_course_unit_position"),
        CheckConstraint(
            "length(btrim(title)) > 0 AND char_length(title) <= 150", name="ck_course_unit_title"
        ),
        CheckConstraint(
            "description IS NULL OR "
            "(length(btrim(description)) > 0 AND char_length(description) <= 2000)",
            name="ck_course_unit_description",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    course_id: Mapped[UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int]
    title: Mapped[str] = mapped_column(String(150))
    normalized_title: Mapped[str] = mapped_column(String(600))
    description: Mapped[str | None] = mapped_column(Text)
    is_archived: Mapped[bool] = mapped_column(Boolean, server_default=false(), default=False)
    created_by_user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class QuestionUnit(Base):
    __tablename__ = "question_units"
    question_id: Mapped[UUID] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True
    )
    unit_id: Mapped[UUID] = mapped_column(
        ForeignKey("course_units.id", ondelete="CASCADE"), primary_key=True, index=True
    )
