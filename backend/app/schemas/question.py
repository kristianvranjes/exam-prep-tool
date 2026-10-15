from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter, model_validator

QuestionType = Literal["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"]
QuestionStatus = Literal["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "ARCHIVED"]
Stem = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=400)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
Difficulty = Annotated[int, Field(ge=1, le=5)]
MAX_QUESTION_UNITS = 5
# One bank page is 20 rows; the cap leaves room without unbounded row locks.
MAX_BULK_QUESTIONS = 50
# A whole course unit fits in one file; the byte cap in settings still bounds the body.
MAX_IMPORT_QUESTIONS = 500


def normalize(text: str) -> str:
    return " ".join(text.split()).casefold()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Option(StrictModel):
    text: Stem
    is_correct: bool


class Content(StrictModel):
    stem: Stem
    explanation: Text | None = None
    difficulty: Difficulty | None = None


class MCQ(Content):
    type: Literal["MULTIPLE_CHOICE"]
    options: list[Option] = Field(min_length=2, max_length=6)

    @model_validator(mode="after")
    def valid_options(self) -> Self:
        if sum(option.is_correct for option in self.options) != 1:
            raise ValueError("Exactly one correct option is required")
        if len({normalize(option.text) for option in self.options}) != len(self.options):
            raise ValueError("Duplicate option text")
        return self


class TrueFalse(Content):
    type: Literal["TRUE_FALSE"]
    correct_answer: bool


class ShortAnswer(Content):
    type: Literal["SHORT_ANSWER"]
    reference_answer: Text


QuestionContent = Annotated[MCQ | TrueFalse | ShortAnswer, Field(discriminator="type")]
content_adapter: TypeAdapter[QuestionContent] = TypeAdapter(QuestionContent)


class ManualConcepts(StrictModel):
    concept_ids: list[Annotated[UUID, Field(strict=False)]] = Field(
        default_factory=list, max_length=5
    )

    @model_validator(mode="after")
    def unique_concepts(self) -> Self:
        if len(set(self.concept_ids)) != len(self.concept_ids):
            raise ValueError("Concept IDs must be unique")
        return self


def unique_ids(ids: list[UUID]) -> list[UUID]:
    if len(set(ids)) != len(ids):
        raise ValueError("Unit IDs must be unique")
    return ids


class ManualUnits(StrictModel):
    unit_ids: list[Annotated[UUID, Field(strict=False)]] = Field(
        default_factory=list, max_length=MAX_QUESTION_UNITS
    )

    @model_validator(mode="after")
    def unique_units(self) -> Self:
        unique_ids(self.unit_ids)
        return self


class CreateMCQ(MCQ, ManualConcepts, ManualUnits):
    pass


class CreateTrueFalse(TrueFalse, ManualConcepts, ManualUnits):
    pass


class CreateShortAnswer(ShortAnswer, ManualConcepts, ManualUnits):
    pass


QuestionCreate = Annotated[
    CreateMCQ | CreateTrueFalse | CreateShortAnswer, Field(discriminator="type")
]


class Citations(StrictModel):
    explanation: Text
    concept_refs: list[str] = Field(min_length=1, max_length=5)
    source_refs: list[str] = Field(min_length=1, max_length=12)


class GeneratedMCQ(MCQ, Citations):
    explanation: Text


class GeneratedTF(TrueFalse, Citations):
    explanation: Text


class GeneratedSA(ShortAnswer, Citations):
    explanation: Text


GeneratedQuestion = Annotated[GeneratedMCQ | GeneratedTF | GeneratedSA, Field(discriminator="type")]


class GeneratedQuestions(StrictModel):
    questions: list[GeneratedQuestion] = Field(min_length=1, max_length=10)


class GenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    concept_ids: list[UUID] = Field(min_length=1, max_length=5)
    question_types: list[QuestionType] = Field(min_length=1, max_length=3)
    count: int = Field(default=5, ge=1, le=10, strict=True)
    retrieval_top_k: int = Field(default=5, ge=1, le=10, strict=True)

    @model_validator(mode="after")
    def unique_selections(self) -> Self:
        if len(set(self.concept_ids)) != len(self.concept_ids) or len(
            set(self.question_types)
        ) != len(self.question_types):
            raise ValueError("Selections must be unique")
        return self


class QuestionPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stem: Stem | None = None
    explanation: Text | None = None
    difficulty: Difficulty | None = Field(default=None, strict=True)
    options: list[Option] | None = None
    correct_answer: bool | None = Field(default=None, strict=True)
    reference_answer: Text | None = None
    concept_ids: list[UUID] | None = Field(default=None, max_length=5)
    unit_ids: list[UUID] | None = Field(default=None, max_length=MAX_QUESTION_UNITS)


Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
QuestionAction = Literal["submit", "approve", "reject", "archive"]


class RejectRequest(StrictModel):
    reason: Reason


class BulkQuestionTransition(StrictModel):
    question_ids: list[Annotated[UUID, Field(strict=False)]] = Field(
        min_length=1, max_length=MAX_BULK_QUESTIONS
    )
    action: QuestionAction
    reason: Reason | None = None

    @model_validator(mode="after")
    def valid(self) -> Self:
        if len(set(self.question_ids)) != len(self.question_ids):
            raise ValueError("Question IDs must be unique")
        if (self.action == "reject") != (self.reason is not None):
            raise ValueError("A reason is required for reject and only for reject")
        return self


class BulkQuestionTransitionResult(BaseModel):
    changed: int


class PublicOption(BaseModel):
    position: int
    text: str


class OwnerOption(PublicOption):
    is_correct: bool


class PublicQuestion(BaseModel):
    visibility: Literal["MEMBER"] = "MEMBER"
    id: UUID
    course_id: UUID
    type: QuestionType
    status: Literal["APPROVED"] = "APPROVED"
    stem: str
    difficulty: int | None
    options: list[PublicOption]
    unit_ids: list[UUID] = []


class SourceReference(BaseModel):
    chunk_id: UUID
    material_id: UUID
    ordinal: int


class OwnerQuestion(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    visibility: Literal["OWNER"] = "OWNER"
    id: UUID
    course_id: UUID
    created_by_user_id: UUID
    ai_job_id: UUID | None
    type: QuestionType
    status: QuestionStatus
    source: str
    stem: str
    explanation: str | None
    difficulty: int | None
    correct_boolean: bool | None
    reference_answer: str | None
    reviewed_by_user_id: UUID | None
    reviewed_at: datetime | None
    rejection_reason: str | None
    created_at: datetime
    updated_at: datetime
    options: list[OwnerOption] = []
    concept_ids: list[UUID] = []
    unit_ids: list[UUID] = []
    source_chunks: list[SourceReference] = []


QuestionResponse = Annotated[OwnerQuestion | PublicQuestion, Field(discriminator="visibility")]


class VersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    version_number: int
    snapshot: dict[str, object]
    changed_by_user_id: UUID
    reason: str
    created_at: datetime


class QuizImport(StrictModel):
    version: Literal["quiz-import-v1"]
    questions: list[QuestionContent] = Field(min_length=1, max_length=MAX_IMPORT_QUESTIONS)

    @model_validator(mode="after")
    def unique_stems(self) -> Self:
        stems = [normalize(q.stem) for q in self.questions]
        if len(set(stems)) != len(stems):
            raise ValueError("Duplicate question stems in import")
        return self
