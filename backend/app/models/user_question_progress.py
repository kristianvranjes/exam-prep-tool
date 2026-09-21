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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
