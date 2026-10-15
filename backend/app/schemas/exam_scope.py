from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.schemas.course_unit import MAX_COURSE_UNITS, UnitId
from app.schemas.question import StrictModel, unique_ids

MAX_EXAM_SCOPES = 100

ExamScopeKind = Literal["MIDTERM", "FINAL", "FULL_EXAM"]
ScopeName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


def consecutive_years(value: str) -> str:
    # FER academic years are written "2025/26": the second part follows the first.
    start, end = value.split("/")
    if (int(start) + 1) % 100 != int(end):
        raise ValueError("Use an academic year such as 2025/26")
    return value


AcademicYear = Annotated[
    str,
    StringConstraints(strip_whitespace=True, pattern=r"^[0-9]{4}/[0-9]{2}$"),
    AfterValidator(consecutive_years),
]
ScopeUnitIds = Annotated[list[UnitId], Field(min_length=1, max_length=MAX_COURSE_UNITS)]


class ExamScopeCreate(StrictModel):
    academic_year: AcademicYear
    kind: ExamScopeKind
    name: ScopeName
    unit_ids: ScopeUnitIds

    @model_validator(mode="after")
    def unique(self) -> Self:
        unique_ids(self.unit_ids)
        return self


class ExamScopeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    academic_year: AcademicYear | None = None
    kind: ExamScopeKind | None = None
    name: ScopeName | None = None
    unit_ids: ScopeUnitIds | None = None

    @model_validator(mode="after")
    def has_change(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Provide an exam scope change")
        for field in self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        if self.unit_ids is not None:
            unique_ids(self.unit_ids)
        return self


class ExamScopeCopy(StrictModel):
    from_year: AcademicYear
    to_year: AcademicYear

    @model_validator(mode="after")
    def different(self) -> Self:
        if self.from_year == self.to_year:
            raise ValueError("Copy to a different academic year")
        return self


class ExamScopeResponse(BaseModel):
    id: UUID
    course_id: UUID
    academic_year: str
    kind: ExamScopeKind
    name: str
    unit_ids: list[UUID]
    approved_question_count: int
    created_at: datetime
    updated_at: datetime
