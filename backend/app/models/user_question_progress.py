from datetime import datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserQuestionProgress(Base):
    __tablename__ = "user_question_progress"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source_question_id: Mapped[UUID] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    stage: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    last_attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("stage >= 0 AND stage <= 5", name="ck_progress_stage_range"),
    )


def calculate_due_date(stage: int, base_timestamp: datetime) -> datetime:
    """
    Calculate the due date based on the stage and base timestamp.

    Args:
        stage: The current stage (0-5).
        base_timestamp: The timestamp to base the due date calculation on.

    Returns:
        The calculated due date.
    """
    stage_due_intervals = {
        0: timedelta(minutes=10),
        1: timedelta(days=1),
        2: timedelta(days=3),
        3: timedelta(days=7),
        4: timedelta(days=14),
        5: timedelta(days=30),
    }

    if stage not in stage_due_intervals:
        raise ValueError(f"Invalid stage: {stage}")

    return base_timestamp + stage_due_intervals[stage]
