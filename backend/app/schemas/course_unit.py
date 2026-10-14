from datetime import datetime
from typing import Annotated, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.question import MAX_QUESTION_UNITS, StrictModel, unique_ids

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


class CourseUnitResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    course_id: UUID
    position: int
    title: str
    description: str | None
    is_archived: bool
    approved_question_count: int = 0
    created_at: datetime
    updated_at: datetime
