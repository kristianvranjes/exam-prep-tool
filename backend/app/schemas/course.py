from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CourseCreate(BaseModel):
    faculty_id: UUID
    name: str = Field(min_length=1, max_length=150)
    code: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=2000)
    # The study year the course is taught in (FER: three undergraduate and two graduate years).
    year_of_study: int | None = Field(default=None, ge=1, le=5)


class CourseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    code: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=2000)
    # An explicit null clears the year.
    year_of_study: int | None = Field(default=None, ge=1, le=5)


class CourseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    faculty_id: UUID
    is_active: bool
    name: str
    code: str | None
    description: str | None
    year_of_study: int | None
    created_by_user_id: UUID
    created_at: datetime
    updated_at: datetime


class CatalogCourse(CourseResponse):
    """A course in the faculty catalog, with the size of its shared question bank."""

    approved_question_count: int


class MembershipResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    course_id: UUID
    user_id: UUID
    role: str
    status: Literal["ACTIVE", "FINISHED"]


class MembershipUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ACTIVE", "FINISHED"]


class NextExam(BaseModel):
    """The dated exam cycle that is in progress or comes next."""

    scope_id: UUID
    name: str
    kind: str
    starts_on: date
    ends_on: date | None


class CourseListItem(CourseResponse):
    """A joined course with what the "Vaši kolegiji" cards show."""

    role: str
    status: Literal["ACTIVE", "FINISHED"]
    approved_question_count: int
    # Share (0-100) of the course's gradable approved questions whose last answer is still
    # retained under readiness-v1's retention proxy; null when the course has none.
    mastery_percent: int | None
    next_exam: NextExam | None
