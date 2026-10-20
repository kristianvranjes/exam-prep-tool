from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ExamPaper(Base):
    """A real past exam as it was set: its questions, order, points and scoring."""

    __tablename__ = "exam_papers"
    __table_args__ = (
        UniqueConstraint(
            "course_id", "academic_year", "normalized_title", name="uq_exam_paper_year_title"
        ),
        CheckConstraint(
            "kind IN ('MIDTERM','FINAL','FULL_EXAM','LAB','QUIZ')", name="ck_exam_paper_kind"
        ),
        CheckConstraint(
            "academic_year ~ '^[0-9]{4}/[0-9]{2}$'", name="ck_exam_paper_academic_year"
        ),
        CheckConstraint(
            "length(btrim(title)) > 0 AND char_length(title) <= 100", name="ck_exam_paper_title"
        ),
        CheckConstraint(
            "term_label IS NULL OR (length(btrim(term_label)) > 0 "
            "AND char_length(term_label) <= 100)",
            name="ck_exam_paper_term_label",
        ),
        CheckConstraint(
            "duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 600",
            name="ck_exam_paper_duration",
        ),
        CheckConstraint(
            "wrong_answer_penalty >= 0 AND wrong_answer_penalty <= 1",
            name="ck_exam_paper_penalty",
        ),
        CheckConstraint(
            "pass_threshold IS NULL OR pass_threshold >= 0", name="ck_exam_paper_threshold"
        ),
        CheckConstraint("status IN ('DRAFT','PUBLISHED')", name="ck_exam_paper_status"),
        CheckConstraint(
            "(status = 'DRAFT' AND published_at IS NULL) OR "
            "(status = 'PUBLISHED' AND published_at IS NOT NULL)",
            name="ck_exam_paper_published",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    course_id: Mapped[UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    academic_year: Mapped[str] = mapped_column(String(7))
    kind: Mapped[str] = mapped_column(String(10))
    title: Mapped[str] = mapped_column(String(100))
    normalized_title: Mapped[str] = mapped_column(String(400))
    # For example "Zimski rok" or "1. termin"; the date stays separate.
    term_label: Mapped[str | None] = mapped_column(String(100))
    exam_date: Mapped[date | None] = mapped_column(Date)
    exam_scope_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("exam_scopes.id", ondelete="SET NULL"), index=True
    )
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    # Fraction of an item's points deducted for a wrong objective answer (0.25 = -1/4).
    wrong_answer_penalty: Mapped[Decimal] = mapped_column(
        Numeric(4, 3), server_default="0", default=Decimal(0)
    )
    pass_threshold: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    status: Mapped[str] = mapped_column(String(10), server_default="DRAFT", default="DRAFT")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ExamPaperItem(Base):
    __tablename__ = "exam_paper_items"
    __table_args__ = (
        UniqueConstraint("paper_id", "position", name="uq_exam_paper_item_position"),
        UniqueConstraint("paper_id", "question_id", name="uq_exam_paper_item_question"),
        CheckConstraint("position >= 0", name="ck_exam_paper_item_position"),
        CheckConstraint("points > 0", name="ck_exam_paper_item_points"),
        CheckConstraint(
            "label IS NULL OR (length(btrim(label)) > 0 AND char_length(label) <= 40)",
            name="ck_exam_paper_item_label",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    paper_id: Mapped[UUID] = mapped_column(ForeignKey("exam_papers.id", ondelete="CASCADE"))
    position: Mapped[int]
    question_id: Mapped[UUID] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), index=True
    )
    points: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    # The original task label, such as "Zadatak 3a".
    label: Mapped[str | None] = mapped_column(String(40))
