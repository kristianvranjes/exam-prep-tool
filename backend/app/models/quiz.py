from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Quiz(Base):
    __tablename__ = "quizzes"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    course_id: Mapped[UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Practice focus frozen at start; the label survives scope or unit edits and deletion.
    exam_scope_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("exam_scopes.id", ondelete="SET NULL"), index=True
    )
    focus_unit_ids: Mapped[list[str]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb"), default=list
    )
    focus_label: Mapped[str | None] = mapped_column(String(300))


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"
    __table_args__ = (
        UniqueConstraint("quiz_id", "position", name="uq_quiz_question_position"),
        CheckConstraint("position >= 0", name="ck_quiz_question_position"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    quiz_id: Mapped[UUID] = mapped_column(ForeignKey("quizzes.id", ondelete="CASCADE"))
    position: Mapped[int]
    # Deliberately no live question/version FK: source deletion cannot alter history.
    source_question_id: Mapped[UUID]
    source_version: Mapped[int]
    snapshot: Mapped[dict[str, object]] = mapped_column(JSONB)


class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE','SUBMITTED','ABANDONED')", name="ck_attempt_status"),
        CheckConstraint(
            "(status = 'ACTIVE' AND submitted_at IS NULL AND abandoned_at IS NULL) OR "
            "(status = 'SUBMITTED' AND submitted_at IS NOT NULL AND abandoned_at IS NULL) OR "
            "(status = 'ABANDONED' AND submitted_at IS NULL AND abandoned_at IS NOT NULL)",
            name="ck_attempt_submission",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    quiz_id: Mapped[UUID] = mapped_column(ForeignKey("quizzes.id", ondelete="CASCADE"), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    abandoned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Answer(Base):
    __tablename__ = "answers"
    __table_args__ = (
        UniqueConstraint("attempt_id", "quiz_question_id", name="uq_answer_question"),
        CheckConstraint(
            "grading_status IN ('PENDING','CORRECT','INCORRECT')", name="ck_answer_grade"
        ),
        CheckConstraint(
            "(grading_method IS NULL AND grading_version IS NULL AND grading_status = 'PENDING')"
            " OR (grading_method IS NOT NULL AND grading_version IS NOT NULL"
            " AND length(grading_version) > 0 AND ("
            "(grading_method = 'DETERMINISTIC' AND grading_status IN ('CORRECT','INCORRECT'))"
            " OR (grading_method = 'PENDING_SEMANTIC' AND grading_status = 'PENDING')))",
            name="ck_answer_grading_provenance",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    attempt_id: Mapped[UUID] = mapped_column(ForeignKey("quiz_attempts.id", ondelete="CASCADE"))
    quiz_question_id: Mapped[UUID] = mapped_column(
        ForeignKey("quiz_questions.id", ondelete="CASCADE")
    )
    payload: Mapped[dict[str, object]] = mapped_column(JSONB)
    grading_status: Mapped[str] = mapped_column(String(20), default="PENDING")
    grading_method: Mapped[str | None] = mapped_column(String(20))
    grading_version: Mapped[str | None] = mapped_column(String(64))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
