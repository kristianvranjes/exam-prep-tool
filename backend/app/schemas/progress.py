from datetime import datetime
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
