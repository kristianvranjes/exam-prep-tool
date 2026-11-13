from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ProgressResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    question_id: UUID
    is_actionable: bool
    review_stage: int
    resolved_review_count: int
    correct_review_count: int
    incorrect_review_count: int
    last_result: Literal["CORRECT", "INCORRECT"]
    last_reviewed_at: datetime
    due_at: datetime


class ReviewRatingRequest(BaseModel):
    """The student's own verdict after seeing the answer: AGAIN (Ponovno), HARD (Teško),
    GOOD (Dobro) or EASY (Lako)."""

    question_id: UUID
    rating: Literal["AGAIN", "HARD", "GOOD", "EASY"]


class ReviewRatingResult(BaseModel):
    """The schedule a rating left: the gap in minutes (the uncapped one), the due time (capped by
    the next exam day), successful repetitions in a row and the times the card was forgotten."""

    question_id: UUID
    rating: Literal["AGAIN", "HARD", "GOOD", "EASY"]
    interval_minutes: int
    due_at: datetime
    repetitions: int
    lapses: int
    scheduling_version: str


class StageCount(BaseModel):
    review_stage: int
    question_count: int


class ProgressSummary(BaseModel):
    as_of: datetime
    reviewed_questions: int
    due_now: int
    upcoming: int
    resolved_review_count: int
    correct_review_count: int
    incorrect_review_count: int
    last_reviewed_at: datetime | None
    next_due_at: datetime | None
    stage_counts: list[StageCount]


class UnitProgress(BaseModel):
    """Review history for questions currently linked to one unit.

    A question linked to several units counts in each, so unit totals overlap.
    """

    unit_id: UUID
    title: str
    position: int
    is_archived: bool
    reviewed_questions: int
    resolved_review_count: int
    correct_review_count: int
    incorrect_review_count: int
    due_now: int


class UnitProgressSummary(BaseModel):
    as_of: datetime
    units: list[UnitProgress]


class ForecastDay(BaseModel):
    date: date
    count: int


class ReviewForecast(BaseModel):
    """Cards coming due per day, Zagreb days from today; overdue cards count toward today."""

    as_of: datetime
    days: list[ForecastDay]
