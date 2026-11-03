from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# How a session was started, recorded for aggregate pilot metrics (docs/PILOT_METRICS.md):
# the requested selection mode, QUICK for the quick quiz (ADAPTIVE selection) and PAPER
# for a past-paper session. NULL on sessions started before migration 0026.
RECORDED_SELECTION_MODES = (
    "STANDARD",
    "ADAPTIVE",
    "MISTAKES",
    "DUE",
    "FAVORITES",
    "MOCK",
    "QUICK",
    "PAPER",
)


class Quiz(Base):
    __tablename__ = "quizzes"
    __table_args__ = (
        CheckConstraint("feedback_mode IN ('END','IMMEDIATE')", name="ck_quiz_feedback_mode"),
        CheckConstraint(
            "selection_mode IS NULL OR selection_mode IN ("
            + ",".join(f"'{mode}'" for mode in RECORDED_SELECTION_MODES)
            + ")",
            name="ck_quiz_selection_mode",
        ),
        CheckConstraint(
            "selection_mode IS NULL OR (selection_mode = 'PAPER') = (scoring IS NOT NULL)",
            name="ck_quiz_selection_mode_paper",
        ),
    )
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
    # IMMEDIATE lets the student check each saved answer before submitting.
    feedback_mode: Mapped[str] = mapped_column(String(10), server_default="END", default="END")
    # A paper session: the paper (null once deleted) and its scoring rule frozen at start.
    exam_paper_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("exam_papers.id", ondelete="SET NULL"), index=True
    )
    scoring: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    # One of RECORDED_SELECTION_MODES; analytics only, never read back by the product.
    selection_mode: Mapped[str | None] = mapped_column(String(10))


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"
    __table_args__ = (
        UniqueConstraint("quiz_id", "position", name="uq_quiz_question_position"),
        CheckConstraint("position >= 0", name="ck_quiz_question_position"),
        CheckConstraint("points IS NULL OR points > 0", name="ck_quiz_question_points"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    quiz_id: Mapped[UUID] = mapped_column(ForeignKey("quizzes.id", ondelete="CASCADE"))
    position: Mapped[int]
    # Deliberately no live question/version FK: source deletion cannot alter history.
    source_question_id: Mapped[UUID]
    source_version: Mapped[int]
    snapshot: Mapped[dict[str, object]] = mapped_column(JSONB)
    # Paper sessions freeze each item's points and original label.
    points: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    label: Mapped[str | None] = mapped_column(String(40))


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
        CheckConstraint(
            "deadline_at IS NULL OR deadline_at > started_at", name="ck_attempt_deadline"
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    quiz_id: Mapped[UUID] = mapped_column(ForeignKey("quizzes.id", ondelete="CASCADE"), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    abandoned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Timed paper sessions: after this, answers are frozen and only submission remains.
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


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
        CheckConstraint(
            "confidence IS NULL OR confidence IN ('SURE','UNSURE','GUESS')",
            name="ck_answer_confidence",
        ),
        CheckConstraint(
            "checked_at IS NULL OR grading_method IS NOT NULL", name="ck_answer_checked_graded"
        ),
        CheckConstraint(
            "self_review IS NULL OR self_review IN ('CORRECT','INCORRECT')",
            name="ck_answer_self_review",
        ),
        CheckConstraint(
            "(self_review IS NULL) = (self_reviewed_at IS NULL)",
            name="ck_answer_self_review_time",
        ),
        CheckConstraint(
            "self_review IS NULL OR grading_method = 'PENDING_SEMANTIC'",
            name="ck_answer_self_review_pending",
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
    # Set once an IMMEDIATE answer is checked; the answer and its grade are then final.
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confidence: Mapped[str | None] = mapped_column(String(10))
    # The student's own verdict on a short answer awaiting review. Never a grade: it does
    # not change grading_status, scores, scheduling, readiness or item analysis.
    self_review: Mapped[str | None] = mapped_column(String(10))
    self_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
