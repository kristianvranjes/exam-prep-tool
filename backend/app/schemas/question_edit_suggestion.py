from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import Field, model_validator

from app.schemas.question import Difficulty, OwnerQuestion, QuestionContent, Stem, StrictModel, Text
from app.schemas.question_report import Details

SuggestionStatus = Literal["OPEN", "RESOLVED"]
SuggestionResolution = Literal["APPLIED", "REJECTED", "SUPERSEDED", "QUESTION_ARCHIVED"]
Position = Annotated[int, Field(ge=0, le=5)]


class OptionTextChange(StrictModel):
    position: Position
    text: Stem


class SuggestionChanges(StrictModel):
    stem: Stem | None = None
    explanation: Text | None = None
    difficulty: Difficulty | None = None
    options: list[OptionTextChange] | None = Field(default=None, min_length=1, max_length=6)
    correct_option_position: Position | None = None
    correct_answer: bool | None = None
    reference_answer: Text | None = None

    @model_validator(mode="after")
    def sparse_changes(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Provide at least one proposed change")
        for name in self.model_fields_set - {"difficulty", "explanation"}:
            if getattr(self, name) is None:
                raise ValueError("Proposed content cannot be null")
        if self.options and len({option.position for option in self.options}) != len(self.options):
            raise ValueError("Option positions must be unique")
        return self


class SuggestionCreate(StrictModel):
    changes: SuggestionChanges
    note: Details | None = None


class SuggestionReceipt(StrictModel):
    id: UUID
    question_id: UUID
    base_version_number: int
    status: SuggestionStatus
    created_at: datetime


class ModeratorSuggestion(SuggestionReceipt):
    suggested_by_user_id: UUID
    note: str | None
    resolution: SuggestionResolution | None
    resolution_reason: str | None
    resolved_by_user_id: UUID | None
    resolved_at: datetime | None
    applied_version_number: int | None
    base_snapshot: OwnerQuestion
    proposed_content: QuestionContent
    question: OwnerQuestion
