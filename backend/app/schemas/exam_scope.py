from datetime import date, datetime
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

# LAB is a lab session, QUIZ a short in-class quiz (blic).
ExamScopeKind = Literal["MIDTERM", "FINAL", "FULL_EXAM", "LAB", "QUIZ"]
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


# Accepts ISO strings from JSON, like the strict models accept UUID strings.
ScopeDate = Annotated[date, Field(strict=False)]


def check_dates(starts_on: date | None, ends_on: date | None) -> None:
    if ends_on is not None and starts_on is None:
        raise ValueError("Set a start date before an end date")
    if starts_on is not None and ends_on is not None and ends_on < starts_on:
        raise ValueError("The end date cannot be before the start date")


class ExamScopeCreate(StrictModel):
    academic_year: AcademicYear
    kind: ExamScopeKind
    name: ScopeName
    unit_ids: ScopeUnitIds
    starts_on: ScopeDate | None = None
    ends_on: ScopeDate | None = None

    @model_validator(mode="after")
    def unique(self) -> Self:
        unique_ids(self.unit_ids)
        check_dates(self.starts_on, self.ends_on)
        return self


class ExamScopeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    academic_year: AcademicYear | None = None
    kind: ExamScopeKind | None = None
    name: ScopeName | None = None
    unit_ids: ScopeUnitIds | None = None
    # Null clears a date; the service checks the resulting pair.
    starts_on: ScopeDate | None = None
    ends_on: ScopeDate | None = None

    @model_validator(mode="after")
    def has_change(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Provide an exam scope change")
        for field in self.model_fields_set - {"starts_on", "ends_on"}:
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
    starts_on: date | None
    ends_on: date | None
    approved_question_count: int
    created_at: datetime
    updated_at: datetime


class ExamScopeCoverage(BaseModel):
    """The caller's progress through a scope's approved questions."""

    scope_id: UUID
    question_count: int
    # Approved scope questions the caller has at least one graded review for.
    reviewed_count: int
