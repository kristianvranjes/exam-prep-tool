from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

FacultyName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)]
UniversityName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


class FacultyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: FacultyName
    university_name: UniversityName | None = None
    # Derived from the name when omitted; lower-case words joined by single hyphens.
    slug: str | None = Field(default=None, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=100)


class FacultyUpdate(BaseModel):
    """A faculty's name and university; the slug stays as it was created."""

    model_config = ConfigDict(extra="forbid")

    name: FacultyName | None = None
    # Null clears it.
    university_name: UniversityName | None = None


class FacultyCreation(BaseModel):
    can_create: bool


class FacultyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    university_name: str | None


class ManagedFacultyResponse(FacultyResponse):
    """A faculty in the list of those who can create faculties, archived ones included."""

    is_active: bool
    # All of its courses, archived ones included; only a faculty without any can be deleted.
    course_count: int
