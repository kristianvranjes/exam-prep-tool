from collections.abc import Sequence
from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.course_unit import MAX_COURSE_UNITS, UnitId
from app.schemas.question import OwnerOption, PublicOption, QuestionType, StrictModel, unique_ids


def default_types() -> list[QuestionType]:
    return ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"]


SelectionMode = Literal["STANDARD", "ADAPTIVE"]


class PracticeFilters(StrictModel):
    """Selection rules shared by session start and the availability summary."""

    selection_mode: SelectionMode = "STANDARD"
    question_types: list[QuestionType] = Field(
        default_factory=default_types,
        min_length=1,
        max_length=3,
    )
    # Optional focus: selected units, or an exam scope that expands to its units.
    unit_ids: list[UnitId] = Field(default_factory=list, max_length=MAX_COURSE_UNITS)
    exam_scope_id: UnitId | None = None

    @model_validator(mode="after")
    def unique_types(self) -> Self:
        if len(set(self.question_types)) != len(self.question_types):
            raise ValueError("Question types must be unique")
        unique_ids(self.unit_ids)
        if self.unit_ids and self.exam_scope_id:
            raise ValueError("Choose units or an exam scope, not both")
        return self


class StartQuiz(PracticeFilters):
    count: int = Field(default=5, ge=1, le=20)


class TypeAvailability(BaseModel):
    type: QuestionType
    count: int


class UnitAvailability(BaseModel):
    unit_id: UUID
    count: int


class PracticeAvailability(BaseModel):
    """Advisory counts; starting a session remains authoritative."""

    # Every practice-eligible course question, ignoring mode, type and focus filters.
    course_total: int
    # Questions a session with these filters could select, per requested type.
    total: int
    by_type: list[TypeAvailability]
    # Per focused unit in unit order; a multi-unit question counts in each unit.
    by_unit: list[UnitAvailability]


class MCQAnswer(StrictModel):
    type: Literal["MULTIPLE_CHOICE"]
    option_position: int = Field(ge=0, le=5)


class BooleanAnswer(StrictModel):
    type: Literal["TRUE_FALSE"]
    value: bool


class TextAnswer(StrictModel):
    type: Literal["SHORT_ANSWER"]
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def nonblank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Answer must contain non-whitespace text")
        if "\x00" in value or any(0xD800 <= ord(char) <= 0xDFFF for char in value):
            raise ValueError("Answer contains unsupported Unicode characters")
        return value


AnswerPayload = Annotated[MCQAnswer | BooleanAnswer | TextAnswer, Field(discriminator="type")]
Grade = Literal["PENDING", "CORRECT", "INCORRECT"]


class AttemptSummary(BaseModel):
    id: UUID
    course_id: UUID
    status: Literal["ACTIVE", "SUBMITTED", "ABANDONED"]
    started_at: datetime
    submitted_at: datetime | None
    exam_scope_id: UUID | None = None
    focus_unit_ids: list[UUID] = []
    focus_label: str | None = None


class QuestionUnitLabel(BaseModel):
    id: UUID
    title: str


class ActiveQuestion(BaseModel):
    id: UUID
    position: int
    type: QuestionType
    stem: str
    difficulty: int | None
    options: Sequence[PublicOption]
    answer: AnswerPayload | None
    # Live organization, not part of the snapshot: current active units in course order.
    units: list[QuestionUnitLabel] = []


class ResultQuestion(ActiveQuestion):
    options: list[OwnerOption]
    explanation: str | None
    correct_boolean: bool | None
    reference_answer: str | None
    grading_status: Grade


class ActiveAttempt(AttemptSummary):
    status: Literal["ACTIVE"] = "ACTIVE"
    questions: list[ActiveQuestion]


class SubmittedAttempt(AttemptSummary):
    status: Literal["SUBMITTED"] = "SUBMITTED"
    questions: list[ResultQuestion]


class AbandonedAttempt(AttemptSummary):
    status: Literal["ABANDONED"] = "ABANDONED"
    abandoned_at: datetime
    questions: list[ActiveQuestion]


AttemptResponse = Annotated[
    ActiveAttempt | SubmittedAttempt | AbandonedAttempt, Field(discriminator="status")
]
