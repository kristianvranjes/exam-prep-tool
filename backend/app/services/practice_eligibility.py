"""Shared source-question availability for practice and actionable progress."""

from uuid import UUID

from sqlalchemy import and_, or_
from sqlalchemy.sql.elements import ColumnElement

from app.models.question import Question


def practice_eligible(user_id: UUID) -> ColumnElement[bool]:
    """Build a predicate only; callers retain course/type scope and transactions."""
    return or_(
        Question.status == "APPROVED",
        and_(
            Question.created_by_user_id == user_id,
            Question.status.in_(["DRAFT", "PENDING_REVIEW"]),
        ),
    )
