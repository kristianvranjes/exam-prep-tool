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


class FacultyCreation(BaseModel):
    can_create: bool


class FacultyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    university_name: str | None
