from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserQuestionProgress(Base):
    __tablename__ = "question_review_progress"
    __table_args__ = (
        UniqueConstraint("user_id", "question_id", name="uq_review_user_question"),
        Index("ix_review_user_due_question", "user_id", "due_at", "question_id"),
        CheckConstraint("review_stage BETWEEN 0 AND 5", name="ck_review_stage"),
        CheckConstraint("last_result IN ('CORRECT','INCORRECT')", name="ck_review_result"),
        CheckConstraint(
            "resolved_review_count > 0 AND correct_review_count >= 0 "
            "AND incorrect_review_count >= 0 "
            "AND resolved_review_count = correct_review_count + incorrect_review_count",
            name="ck_review_counts",
        ),
        CheckConstraint("length(scheduling_version) > 0", name="ck_review_version"),
        CheckConstraint(
            "interval_minutes IS NULL OR interval_minutes > 0", name="ck_review_interval"
        ),
        CheckConstraint("repetitions >= 0 AND lapses >= 0", name="ck_review_repetitions"),
        CheckConstraint(
            "last_rating IS NULL OR last_rating IN ('AGAIN', 'HARD', 'GOOD', 'EASY')",
            name="ck_review_last_rating",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    question_id: Mapped[UUID] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), index=True
    )
    review_stage: Mapped[int]
    resolved_review_count: Mapped[int]
    correct_review_count: Mapped[int]
    incorrect_review_count: Mapped[int]
    last_result: Mapped[str] = mapped_column(String(20))
    last_reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    scheduling_version: Mapped[str] = mapped_column(String(64))
    # Rating-based scheduling (srs-v2): the current gap, successful repetitions in a row, forgotten
    # times and the last rating. Null/zero on rows no rating has touched, until migration 0029's
    # derived values are replaced by the first rating.
    interval_minutes: Mapped[int | None]
    repetitions: Mapped[int] = mapped_column(server_default="0", default=0)
    lapses: Mapped[int] = mapped_column(server_default="0", default=0)
    last_rating: Mapped[str | None] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReviewRatingEvent(Base):
    """One rating a student gave a question, kept so the history survives later reschedules."""

    __tablename__ = "review_rating_events"
    __table_args__ = (
        Index("ix_rating_event_user_question", "user_id", "question_id", "rated_at"),
        CheckConstraint(
            "rating IN ('AGAIN', 'HARD', 'GOOD', 'EASY')", name="ck_rating_event_rating"
        ),
        CheckConstraint("interval_minutes > 0", name="ck_rating_event_interval"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    question_id: Mapped[UUID] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"))
    rating: Mapped[str] = mapped_column(String(10))
    rated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    interval_minutes: Mapped[int]
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    scheduling_version: Mapped[str] = mapped_column(String(64))
