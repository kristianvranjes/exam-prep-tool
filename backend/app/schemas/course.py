from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

MembershipStatus = Literal["ACTIVE", "DONE", "HIDDEN"]
# The exam kinds a student counts down to; labs and short quizzes are not exams.
EXAM_KINDS = ("MIDTERM", "FINAL", "FULL_EXAM")


class CourseCreate(BaseModel):
    faculty_id: UUID
    name: str = Field(min_length=1, max_length=150)
    code: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=2000)
    year_of_study: int | None = Field(default=None, ge=1, le=6)


class CourseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    code: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=2000)
    # Only a faculty moderator may change it; null clears it.
    year_of_study: int | None = Field(default=None, ge=1, le=6)


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


class NextExam(BaseModel):
    """The nearest exam of a course that is today or later (a running one counts)."""

    scope_id: UUID
    kind: Literal["MIDTERM", "FINAL", "FULL_EXAM"]
    name: str
    starts_on: date
    ends_on: date | None


class MemberCourseResponse(CourseResponse):
    """A course in the caller's own list, with the caller's status and the course's numbers."""

    membership_status: MembershipStatus
    approved_question_count: int
    next_exam: NextExam | None


class CatalogCourseResponse(CourseResponse):
    """A course in a faculty's enrolment catalog."""

    approved_question_count: int
    # Whether the faculty has any moderator who can add and review questions.
    has_moderators: bool


class MembershipResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    course_id: UUID
    user_id: UUID
    role: str
    status: MembershipStatus


class MembershipUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: MembershipStatus
