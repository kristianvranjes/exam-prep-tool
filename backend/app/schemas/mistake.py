from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.question import QuestionType
from app.schemas.quiz import FocusFilters, QuestionUnitLabel


class MistakeQuery(FocusFilters):
    """The practice focus plus the pagination every course list uses."""

    # Query strings arrive as text, so these two parse it like the other list routes.
    limit: int = Field(20, ge=1, le=100, strict=False)
    offset: int = Field(0, ge=0, le=10000, strict=False)


class MistakeQuestion(BaseModel):
    """A question the caller last answered incorrectly; never its key or explanation."""

    question_id: UUID
    type: QuestionType
    stem: str
    difficulty: int | None
    # Current active units; archived units and deleted links simply drop out.
    units: list[QuestionUnitLabel]
    last_reviewed_at: datetime
    incorrect_review_count: int
    # False once the question is archived, rejected or otherwise not practice-eligible.
    available: bool
