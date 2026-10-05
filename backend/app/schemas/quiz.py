from collections.abc import Sequence
from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.question import OwnerOption, PublicOption, QuestionType, StrictModel


def default_types() -> list[QuestionType]:
    return ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"]


class StartQuiz(StrictModel):
    selection_mode: Literal["STANDARD", "ADAPTIVE"] = "STANDARD"
    count: int = Field(default=5, ge=1, le=20)
    question_types: list[QuestionType] = Field(
        default_factory=default_types,
        min_length=1,
        max_length=3,
    )

    @model_validator(mode="after")
    def unique_types(self) -> Self:
        if len(set(self.question_types)) != len(self.question_types):
            raise ValueError("Question types must be unique")
        return self


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


class ActiveQuestion(BaseModel):
    id: UUID
    position: int
    type: QuestionType
    stem: str
    difficulty: int | None
    options: Sequence[PublicOption]
    answer: AnswerPayload | None


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
