from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class QuestionReport(Base):
    __tablename__ = "question_reports"
    __table_args__ = (
        CheckConstraint(
            "reason IN ('INCORRECT_ANSWER','MULTIPLE_CORRECT','UNCLEAR','TYPO',"
            "'OUTDATED','DUPLICATE','OTHER')",
            name="ck_question_report_reason",
        ),
        CheckConstraint(
            "details IS NULL OR (length(btrim(details)) > 0 AND char_length(details) <= 1000)",
            name="ck_question_report_details",
        ),
        CheckConstraint(
            "reason != 'OTHER' OR details IS NOT NULL", name="ck_question_report_other"
        ),
        CheckConstraint(
            "(status = 'OPEN' AND resolution IS NULL AND resolved_by_user_id IS NULL "
            "AND resolved_at IS NULL) OR (status = 'RESOLVED' "
            "AND resolution IS NOT NULL AND resolution IN ('DISMISSED','QUESTION_ARCHIVED') "
            "AND resolved_at IS NOT NULL)",
            name="ck_question_report_resolution",
        ),
        Index(
            "uq_question_report_open",
            "question_id",
            "reported_by_user_id",
            unique=True,
            postgresql_where=text("status = 'OPEN'"),
        ),
        Index("ix_question_reports_reporter", "reported_by_user_id"),
        Index("ix_question_reports_queue", "status", "created_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    question_id: Mapped[UUID] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"))
    reported_by_user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    reason: Mapped[str] = mapped_column(String(20))
    details: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="OPEN")
    resolution: Mapped[str | None] = mapped_column(String(20))
    resolved_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
