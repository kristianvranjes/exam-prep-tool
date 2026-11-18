from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, Numeric, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class StudyPlan(Base):
    """One student's plan settings for one course (#173). The plan itself is never stored."""

    __tablename__ = "study_plans"
    __table_args__ = (
        CheckConstraint("daily_minutes BETWEEN 10 AND 240", name="ck_study_plan_minutes"),
        CheckConstraint(
            "target_points IS NULL OR (target_points > 0 AND target_points <= 1000)",
            name="ck_study_plan_target",
        ),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    course_id: Mapped[UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True
    )
    # The chosen exam cycle; null means the next dated one.
    exam_scope_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("exam_scopes.id", ondelete="SET NULL")
    )
    target_points: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    daily_minutes: Mapped[int] = mapped_column(Integer, default=40)
    plan_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
