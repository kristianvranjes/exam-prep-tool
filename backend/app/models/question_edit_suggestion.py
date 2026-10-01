from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class QuestionEditSuggestion(Base):
    __tablename__ = "question_edit_suggestions"
    __table_args__ = (
        CheckConstraint("base_version_number >= 1", name="ck_suggestion_base_version"),
        CheckConstraint("jsonb_typeof(proposed_content) = 'object'", name="ck_suggestion_content"),
        CheckConstraint(
            "note IS NULL OR (length(btrim(note)) > 0 AND char_length(note) <= 1000)",
            name="ck_suggestion_note",
        ),
        CheckConstraint("status IN ('OPEN','RESOLVED')", name="ck_suggestion_status"),
        CheckConstraint(
            "resolution IS NULL OR resolution IN "
            "('APPLIED','REJECTED','SUPERSEDED','QUESTION_ARCHIVED')",
            name="ck_suggestion_resolution",
        ),
        CheckConstraint(
            "resolution_reason IS NULL OR (length(btrim(resolution_reason)) > 0 "
            "AND char_length(resolution_reason) <= 1000)",
            name="ck_suggestion_reason",
        ),
        CheckConstraint(
            "(status = 'OPEN' AND resolution IS NULL AND resolution_reason IS NULL "
            "AND resolved_by_user_id IS NULL AND resolved_at IS NULL "
            "AND applied_version_number IS NULL) OR (status = 'RESOLVED' "
            "AND resolution IS NOT NULL AND resolved_at IS NOT NULL)",
            name="ck_suggestion_state",
        ),
        CheckConstraint(
            "resolution IS NULL OR (resolution = 'APPLIED' "
            "AND applied_version_number IS NOT NULL AND applied_version_number > 0 "
            "AND resolution_reason IS NULL) OR (resolution = 'REJECTED' "
            "AND applied_version_number IS NULL AND resolution_reason IS NOT NULL) "
            "OR (resolution IN ('SUPERSEDED','QUESTION_ARCHIVED') "
            "AND applied_version_number IS NULL AND resolution_reason IS NULL)",
            name="ck_suggestion_decision",
        ),
        Index("ix_suggestions_question", "question_id"),
        Index("ix_suggestions_suggester", "suggested_by_user_id"),
        Index("ix_suggestions_queue", "status", "created_at", "id"),
        Index(
            "uq_question_suggestion_open",
            "question_id",
            "suggested_by_user_id",
            unique=True,
            postgresql_where=text("status = 'OPEN'"),
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    question_id: Mapped[UUID] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"))
    suggested_by_user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    base_version_number: Mapped[int]
    proposed_content: Mapped[dict[str, object]] = mapped_column(JSONB)
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="OPEN", server_default="OPEN")
    resolution: Mapped[str | None] = mapped_column(String(20))
    resolution_reason: Mapped[str | None] = mapped_column(Text)
    resolved_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    applied_version_number: Mapped[int | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
