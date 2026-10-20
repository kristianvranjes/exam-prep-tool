from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ExamScope(Base):
    """An exam cycle for one academic year: the units a midterm, final or full exam covers."""

    __tablename__ = "exam_scopes"
    __table_args__ = (
        UniqueConstraint(
            "course_id", "academic_year", "normalized_name", name="uq_exam_scope_year_name"
        ),
        CheckConstraint(
            "kind IN ('MIDTERM','FINAL','FULL_EXAM','LAB','QUIZ')", name="ck_exam_scope_kind"
        ),
        CheckConstraint(
            "ends_on IS NULL OR (starts_on IS NOT NULL AND ends_on >= starts_on)",
            name="ck_exam_scope_dates",
        ),
        CheckConstraint(
            "academic_year ~ '^[0-9]{4}/[0-9]{2}$'", name="ck_exam_scope_academic_year"
        ),
        CheckConstraint(
            "length(btrim(name)) > 0 AND char_length(name) <= 100", name="ck_exam_scope_name"
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    course_id: Mapped[UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    academic_year: Mapped[str] = mapped_column(String(7))
    kind: Mapped[str] = mapped_column(String(10))
    name: Mapped[str] = mapped_column(String(100))
    normalized_name: Mapped[str] = mapped_column(String(400))
    # Optional calendar window: an exam day, or a multi-day exam period.
    starts_on: Mapped[date | None] = mapped_column(Date)
    ends_on: Mapped[date | None] = mapped_column(Date)
    created_by_user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ExamScopeUnit(Base):
    __tablename__ = "exam_scope_units"
    scope_id: Mapped[UUID] = mapped_column(
        ForeignKey("exam_scopes.id", ondelete="CASCADE"), primary_key=True
    )
    unit_id: Mapped[UUID] = mapped_column(
        ForeignKey("course_units.id", ondelete="CASCADE"), primary_key=True, index=True
    )
