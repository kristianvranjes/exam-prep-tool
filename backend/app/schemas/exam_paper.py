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

from app.schemas.course_unit import UnitId
from app.schemas.exam_scope import AcademicYear, ExamScopeKind, ScopeDate
from app.schemas.question import QuestionStatus, QuestionType, StrictModel, unique_ids

MAX_PAPER_ITEMS = 60
MAX_COURSE_PAPERS = 200

PaperStatus = Literal["DRAFT", "PUBLISHED"]
PaperTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
TermLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
ItemLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


def hundredths(value: float) -> float:
    # Points are stored with two decimals; reject anything finer instead of rounding it away.
    if round(value, 2) != value:
        raise ValueError("Use at most two decimal places")
    return value


def thousandths(value: float) -> float:
    if round(value, 3) != value:
        raise ValueError("Use at most three decimal places")
    return value


Points = Annotated[float, Field(gt=0, le=1000), AfterValidator(hundredths)]
Threshold = Annotated[float, Field(ge=0, le=60000), AfterValidator(hundredths)]
# 0.25 deducts a quarter of the item's points for a wrong objective answer.
PenaltyFraction = Annotated[float, Field(ge=0, le=1), AfterValidator(thousandths)]
Duration = Annotated[int, Field(ge=1, le=600)]


class ExamPaperCreate(StrictModel):
    academic_year: AcademicYear
    kind: ExamScopeKind
    title: PaperTitle
    term_label: TermLabel | None = None
    exam_date: ScopeDate | None = None
    exam_scope_id: UnitId | None = None
    duration_minutes: Duration | None = None
    wrong_answer_penalty: PenaltyFraction = 0
    pass_threshold: Threshold | None = None


class ExamPaperUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    academic_year: AcademicYear | None = None
    kind: ExamScopeKind | None = None
    title: PaperTitle | None = None
    # Null clears these optional fields.
    term_label: TermLabel | None = None
    exam_date: ScopeDate | None = None
    exam_scope_id: UnitId | None = None
    duration_minutes: Duration | None = None
    wrong_answer_penalty: PenaltyFraction | None = None
    pass_threshold: Threshold | None = None

    @model_validator(mode="after")
    def has_change(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Provide an exam paper change")
        required = {"academic_year", "kind", "title", "wrong_answer_penalty"}
        for field in self.model_fields_set & required:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class ExamPaperItemInput(StrictModel):
    question_id: UnitId
    points: Points
    label: ItemLabel | None = None


class ExamPaperItems(StrictModel):
    """The paper's complete item list in order; it replaces the current items."""

    items: list[ExamPaperItemInput] = Field(max_length=MAX_PAPER_ITEMS)

    @model_validator(mode="after")
    def unique(self) -> Self:
        unique_ids([item.question_id for item in self.items])
        return self


class PaperBest(BaseModel):
    """The caller's best finished attempt at a paper, by the points it earned."""

    earned: float
    max_points: float


class ExamPaperSummary(BaseModel):
    id: UUID
    course_id: UUID
    academic_year: str
    kind: ExamScopeKind
    title: str
    term_label: str | None
    exam_date: date | None
    exam_scope_id: UUID | None
    duration_minutes: int | None
    wrong_answer_penalty: float
    pass_threshold: float | None
    status: PaperStatus
    published_at: datetime | None
    item_count: int
    total_points: float
    created_at: datetime
    updated_at: datetime
    # Only the list fills it, and only with the caller's own attempts.
    best: PaperBest | None = None


class PaperItemPublic(BaseModel):
    """What any member sees before taking the paper: structure, never content."""

    position: int
    label: str | None
    points: float
    type: QuestionType


class PaperItemManager(PaperItemPublic):
    question_id: UUID
    stem: str
    question_status: QuestionStatus


class ExamPaperDetail(ExamPaperSummary):
    can_manage: bool
    items: list[PaperItemPublic | PaperItemManager]


class ExamPaperList(BaseModel):
    can_manage: bool
    papers: list[ExamPaperSummary]
