from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.question import MAX_BULK_QUESTIONS, MAX_QUESTION_UNITS, StrictModel, unique_ids

MAX_COURSE_UNITS = 50

UnitTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)]
UnitDescription = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
]
UnitId = Annotated[UUID, Field(strict=False)]


class CourseUnitCreate(StrictModel):
    title: UnitTitle
    description: UnitDescription | None = None


class CourseUnitUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: UnitTitle | None = None
    # An explicit null clears the description; omission keeps it.
    description: UnitDescription | None = None

    @model_validator(mode="after")
    def has_change(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Provide a unit change")
        if "title" in self.model_fields_set and self.title is None:
            raise ValueError("A unit title is required")
        return self


class CourseUnitMerge(StrictModel):
    """Move a unit's questions and exam scopes into another unit, then remove it."""

    into_unit_id: UnitId
    # Renames the unit that stays, so "Analiza (1/3)" can become "Analiza" in one step.
    title: UnitTitle | None = None


class CourseUnitOrder(StrictModel):
    unit_ids: list[UnitId] = Field(min_length=1, max_length=MAX_COURSE_UNITS)

    @model_validator(mode="after")
    def unique(self) -> Self:
        unique_ids(self.unit_ids)
        return self


class QuestionUnits(StrictModel):
    unit_ids: list[UnitId] = Field(max_length=MAX_QUESTION_UNITS)

    @model_validator(mode="after")
    def unique(self) -> Self:
        unique_ids(self.unit_ids)
        return self


class BulkQuestionUnits(StrictModel):
    question_ids: list[Annotated[UUID, Field(strict=False)]] = Field(
        min_length=1, max_length=MAX_BULK_QUESTIONS
    )
    unit_id: UnitId
    action: Literal["ADD", "REMOVE"]

    @model_validator(mode="after")
    def unique(self) -> Self:
        if len(set(self.question_ids)) != len(self.question_ids):
            raise ValueError("Question IDs must be unique")
        return self


class BulkQuestionUnitsResult(BaseModel):
    changed: int
    unchanged: int


UnitStatus = Literal["DRAFT", "PENDING_REVIEW", "PUBLISHED"]


class UnitPerson(BaseModel):
    id: UUID
    display_name: str


class CourseUnitResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    course_id: UUID
    position: int
    title: str
    description: str | None
    is_archived: bool
    # Review state of the unit as a quiz: its author wrote it, a moderator published it.
    status: UnitStatus
    author: UnitPerson | None = None
    reviewer: UnitPerson | None = None
    reviewed_at: datetime | None
    approved_question_count: int = 0
    created_at: datetime
    updated_at: datetime
