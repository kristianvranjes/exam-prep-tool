from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.schemas.question import QuestionType


class FavoriteState(BaseModel):
    """The caller's favorite on one question after an idempotent add or remove."""

    question_id: UUID
    favorite: bool
    # The first time it was added; repeating the add keeps it.
    favorited_at: datetime | None


class FavoriteQuestion(BaseModel):
    question_id: UUID
    favorited_at: datetime
    type: QuestionType
    stem: str
    difficulty: int | None
    # False once the question is archived, rejected or otherwise not practice-eligible.
    available: bool
