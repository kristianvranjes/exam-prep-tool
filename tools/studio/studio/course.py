"""course.yaml: units with page ranges and exam cycles, confirmed by the course owner.

`studio ingest` writes `course.proposed.yaml`; the owner edits it and saves it as
`course.yaml`. The studio never writes `course.yaml` itself.
"""

from pathlib import Path
from typing import Literal, Self

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from studio.config import UUID_PATTERN, Course, StudioError, TypeCounts, check_counts
from studio.ingest import PdfPages

COURSE_NAME = "course.yaml"
PROPOSAL_NAME = "course.proposed.yaml"
COURSE_VERSION: Literal["studio-course-v1"] = "studio-course-v1"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceRange(Strict):
    pdf: str = Field(min_length=1)
    pages: str = Field(pattern=r"^\d+(-\d+)?$")

    @field_validator("pages", mode="before")
    @classmethod
    def single_page(cls, value: object) -> object:
        # YAML reads `pages: 7` as an integer.
        return str(value) if isinstance(value, int) and not isinstance(value, bool) else value

    @property
    def bounds(self) -> tuple[int, int]:
        start, _, end = self.pages.partition("-")
        return int(start), int(end or start)

    @model_validator(mode="after")
    def ordered(self) -> Self:
        start, end = self.bounds
        if start < 1 or end < start:
            raise ValueError(f"page range {self.pages!r} must start at 1 and not run backwards")
        return self


class Unit(Strict):
    id: str = Field(pattern=r"^\d{2,3}$")
    title: str = Field(min_length=1, max_length=200)
    sources: list[SourceRange] = Field(min_length=1)
    # Overrides the studio.toml blueprint for this unit.
    questions: TypeCounts | None = None
    # The matching course unit in the application, for `studio push`.
    app_unit: str | None = Field(default=None, pattern=UUID_PATTERN)

    @field_validator("questions")
    @classmethod
    def valid_counts(cls, counts: TypeCounts | None) -> TypeCounts | None:
        return None if counts is None else check_counts(counts)


class ExamCycle(Strict):
    name: str = Field(min_length=1, max_length=100)
    units: list[str] = Field(min_length=1)


class CourseFile(Strict):
    version: Literal["studio-course-v1"]
    course: Course
    units: list[Unit] = Field(min_length=1)
    exam_cycles: list[ExamCycle] = Field(default_factory=list)

    @model_validator(mode="after")
    def references(self) -> Self:
        ids = [u.id for u in self.units]
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            raise ValueError(f"duplicate unit ids: {', '.join(duplicates)}")
        for cycle in self.exam_cycles:
            unknown = [u for u in cycle.units if u not in ids]
            if unknown:
                raise ValueError(f"exam cycle {cycle.name!r} names unknown units: {unknown}")
        return self


def check_pages(course: CourseFile, docs: dict[str, PdfPages]) -> list[str]:
    """Problems between a course file and the ingested PDFs; empty when consistent."""
    problems = []
    for unit in course.units:
        for source in unit.sources:
            doc = docs.get(source.pdf)
            if doc is None:
                problems.append(f"unit {unit.id}: no ingested PDF named {source.pdf!r}")
            elif source.bounds[1] > doc.page_count:
                problems.append(
                    f"unit {unit.id}: pages {source.pages} exceed {source.pdf} "
                    f"({doc.page_count} pages)"
                )
    return problems


def load_course(studio_dir: Path) -> CourseFile | None:
    path = studio_dir / COURSE_NAME
    if not path.is_file():
        return None
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise StudioError(f"{path}: {exc}") from None
    try:
        return CourseFile.model_validate(data)
    except ValueError as exc:
        raise StudioError(f"{path}: {exc}") from None


def dump_course(course: CourseFile, header: list[str]) -> str:
    comments = "".join(f"# {line}\n" if line else "#\n" for line in header)
    data = course.model_dump(exclude_none=True)
    body = yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=100)
    return comments + body
