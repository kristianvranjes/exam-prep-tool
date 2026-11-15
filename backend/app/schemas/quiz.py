from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.course_unit import MAX_COURSE_UNITS, UnitId
from app.schemas.question import OwnerOption, PublicOption, QuestionType, StrictModel, unique_ids
from app.services.numbers import MAX_ANSWER_LENGTH, parse_number


def default_types() -> list[QuestionType]:
    return ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT", "MATCH"]


# MISTAKES and DUE narrow selection to the student's review progress, FAVORITES to their
# favorites; MOCK spreads a session evenly across an exam scope's units. See docs/PRACTICE.md.
SelectionMode = Literal["STANDARD", "ADAPTIVE", "MISTAKES", "DUE", "FAVORITES", "MOCK"]
FeedbackMode = Literal["END", "IMMEDIATE"]
Confidence = Literal["SURE", "UNSURE", "GUESS"]


class FocusFilters(StrictModel):
    """Type and unit focus shared by practice and the review lists that lead into it."""

    question_types: list[QuestionType] = Field(
        default_factory=default_types,
        min_length=1,
        max_length=6,
    )
    # Optional focus: selected units, or an exam scope that expands to its units.
    unit_ids: list[UnitId] = Field(default_factory=list, max_length=MAX_COURSE_UNITS)
    exam_scope_id: UnitId | None = None

    @model_validator(mode="after")
    def unique_focus(self) -> Self:
        if len(set(self.question_types)) != len(self.question_types):
            raise ValueError("Question types must be unique")
        unique_ids(self.unit_ids)
        if self.unit_ids and self.exam_scope_id:
            raise ValueError("Choose units or an exam scope, not both")
        return self


class PracticeFilters(FocusFilters):
    """Selection rules shared by session start and the availability summary."""

    selection_mode: SelectionMode = "STANDARD"

    @model_validator(mode="after")
    def mock_needs_scope(self) -> Self:
        if self.selection_mode == "MOCK" and self.exam_scope_id is None:
            raise ValueError("A mock exam needs an exam scope")
        return self


# Generated sessions hold at most 20 questions; only a mock exam may go up to a paper's size.
MAX_GENERATED_QUESTIONS = 20
MAX_MOCK_QUESTIONS = 60
MAX_MOCK_MINUTES = 600


class StartQuiz(PracticeFilters):
    count: int = Field(default=5, ge=1, le=MAX_MOCK_QUESTIONS)
    # Not a selection filter: availability is the same in both modes.
    feedback_mode: FeedbackMode = "END"
    # Marks the quick quiz, an ADAPTIVE preset; only the recorded mode (QUICK) differs.
    quick_quiz: bool = False

    @model_validator(mode="after")
    def quick_quiz_is_adaptive(self) -> Self:
        if self.quick_quiz and self.selection_mode != "ADAPTIVE":
            raise ValueError("A quick quiz uses ADAPTIVE selection")
        return self

    @model_validator(mode="after")
    def count_within_mode_limit(self) -> Self:
        if self.selection_mode != "MOCK" and self.count > MAX_GENERATED_QUESTIONS:
            raise ValueError(f"At most {MAX_GENERATED_QUESTIONS} questions outside a mock exam")
        return self


class StartMock(StrictModel):
    """A generated exam simulation: questions spread across an exam scope, one point each.

    Without `duration_minutes` the exam has no time limit. Results come at the end by default,
    as in a real exam; there is no negative marking and no pass mark.
    """

    exam_scope_id: UnitId
    count: int = Field(default=20, ge=1, le=MAX_MOCK_QUESTIONS)
    duration_minutes: int | None = Field(default=None, ge=1, le=MAX_MOCK_MINUTES)
    question_types: list[QuestionType] = Field(
        default_factory=default_types, min_length=1, max_length=6
    )
    feedback_mode: FeedbackMode = "END"

    @model_validator(mode="after")
    def unique_types(self) -> Self:
        if len(set(self.question_types)) != len(self.question_types):
            raise ValueError("Question types must be unique")
        return self


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
    # What MISTAKES, DUE and FAVORITES would select with the same types and focus,
    # whatever the mode.
    mistakes_total: int = 0
    due_total: int = 0
    favorites_total: int = 0


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


class NumericAnswer(StrictModel):
    type: Literal["NUMERIC"]
    # Kept as typed ("9,81"); parsed the same way when saved and when graded.
    value: str = Field(min_length=1, max_length=MAX_ANSWER_LENGTH)

    @field_validator("value")
    @classmethod
    def parseable(cls, value: str) -> str:
        parse_number(value)
        return value


class MultipleSelectAnswer(StrictModel):
    type: Literal["MULTIPLE_SELECT"]
    option_positions: list[Annotated[int, Field(ge=0, le=5)]] = Field(min_length=1, max_length=6)

    @field_validator("option_positions")
    @classmethod
    def unique_positions(cls, value: list[int]) -> list[int]:
        if len(set(value)) != len(value):
            raise ValueError("Choose each option at most once")
        return sorted(value)


class MatchAnswer(StrictModel):
    """`matches[i]` is the item of the shown right-hand column chosen for left item i, or null
    while it is still unmatched; each right-hand item can be used once."""

    type: Literal["MATCH"]
    matches: list[Annotated[int, Field(ge=0, le=5)] | None] = Field(min_length=2, max_length=6)

    @model_validator(mode="after")
    def valid_matches(self) -> Self:
        chosen = [match for match in self.matches if match is not None]
        if not chosen:
            raise ValueError("Match at least one pair")
        if len(set(chosen)) != len(chosen):
            raise ValueError("Use each item at most once")
        if max(chosen) >= len(self.matches):
            raise ValueError("Match to an item that exists")
        return self


AnswerPayload = Annotated[
    MCQAnswer | BooleanAnswer | TextAnswer | NumericAnswer | MultipleSelectAnswer | MatchAnswer,
    Field(discriminator="type"),
]
Grade = Literal["PENDING", "CORRECT", "INCORRECT"]
# The student's own verdict on a card: AGAIN (Ponovno), HARD (Teško), GOOD (Dobro), EASY (Lako).
ReviewRating = Literal["AGAIN", "HARD", "GOOD", "EASY"]
# A student's own verdict on a short answer; never a grade. See docs/PRACTICE.md.
SelfReview = Literal["CORRECT", "INCORRECT"]
# Results also mark questions left blank in a paper session.
ResultGrade = Literal["PENDING", "CORRECT", "INCORRECT", "UNANSWERED"]


class StartPaper(StrictModel):
    # A past paper is usually an exam simulation, so results come at the end.
    feedback_mode: FeedbackMode = "END"
    # Enforce the paper's time limit, when it has one.
    timed: bool = True


class PaperSession(BaseModel):
    """The paper's scoring rule as frozen when the session started."""

    exam_paper_id: UUID | None
    title: str
    total_points: float
    wrong_answer_penalty: float
    pass_threshold: float | None
    duration_minutes: int | None


class PaperScore(BaseModel):
    version: str
    earned: float
    max_points: float
    correct_points: float
    penalty_points: float
    # Points of short answers awaiting self-review; never guessed into `earned`.
    pending_points: float
    unanswered_count: int
    # None when there is no pass mark or pending answers could still decide it.
    passed: bool | None


class CheckAnswer(StrictModel):
    confidence: Confidence | None = None


class RateAnswer(StrictModel):
    # Null takes a rating back.
    rating: ReviewRating | None


class SelfReviewRequest(StrictModel):
    # Null clears an earlier self-assessment.
    verdict: SelfReview | None


class SelfReviewSummary(BaseModel):
    """Self-assessment of the short answers awaiting review; reported apart from grades."""

    correct: int
    incorrect: int
    unreviewed: int
    # Paper sessions only: points of items self-assessed as correct, and of items not yet
    # self-assessed. Never added to the objective score.
    correct_points: float | None = None
    unreviewed_points: float | None = None


class AttemptSummary(BaseModel):
    id: UUID
    course_id: UUID
    status: Literal["ACTIVE", "SUBMITTED", "ABANDONED"]
    started_at: datetime
    submitted_at: datetime | None
    exam_scope_id: UUID | None = None
    focus_unit_ids: list[UUID] = []
    focus_label: str | None = None
    feedback_mode: FeedbackMode = "END"
    paper: PaperSession | None = None
    deadline_at: datetime | None = None
    # Active timed sessions only: lets clients count down against the server clock.
    server_time: datetime | None = None


class QuestionUnitLabel(BaseModel):
    id: UUID
    title: str


class QuestionFeedback(BaseModel):
    """Key and explanation for one question, revealed once its answer is checked or graded."""

    options: list[OwnerOption]
    explanation: str | None
    correct_boolean: bool | None
    reference_answer: str | None
    grading_status: Grade
    # MATCH: for each left item, the shown right-hand item that is its partner.
    correct_matches: list[int] | None = None
    # Multiple select and matching: the share of the item's points earned (1, 0.5 or 0); null
    # for other types
    # and for answers graded before partial credit, which are all or nothing.
    score_fraction: float | None = None
    confidence: Confidence | None = None
    # SHORT_ANSWER only: the student's self-assessment, separate from grading_status.
    self_review: SelfReview | None = None
    # NUMERIC keys; null for other types.
    correct_value: Decimal | None = None
    absolute_tolerance: Decimal | None = None
    relative_tolerance: Decimal | None = None


class ActiveQuestion(BaseModel):
    id: UUID
    # The bank question this snapshot was taken from; favorites refer to it.
    source_question_id: UUID
    position: int
    type: QuestionType
    stem: str
    difficulty: int | None
    options: Sequence[PublicOption]
    # MATCH: the right-hand column in the order shown for this session; `options` are the left
    # items.
    choices: list[PublicOption] | None = None
    hint: str | None = None
    expr: str | None = None
    answer: AnswerPayload | None
    # Live organization, not part of the snapshot: current active units in course order.
    units: list[QuestionUnitLabel] = []
    # Live too, but read only from the student's own favorites: bank edits and archiving
    # never change it.
    favorite: bool = False
    # The card rating given after the answer was checked; applied when the session is submitted.
    rating: ReviewRating | None = None
    # Only for IMMEDIATE answers that were checked; unchecked questions never carry keys.
    feedback: QuestionFeedback | None = None
    # Paper sessions only: the item's frozen points and original label.
    points: float | None = None
    label: str | None = None
    # NUMERIC only: the unit the answer is expected in.
    unit: str | None = None


class ResultQuestion(ActiveQuestion):
    options: list[OwnerOption]
    explanation: str | None
    correct_boolean: bool | None
    reference_answer: str | None
    grading_status: ResultGrade
    correct_matches: list[int] | None = None
    score_fraction: float | None = None
    confidence: Confidence | None = None
    self_review: SelfReview | None = None
    correct_value: Decimal | None = None
    absolute_tolerance: Decimal | None = None
    relative_tolerance: Decimal | None = None
    # Paper sessions only; None while a short answer awaits self-review.
    earned_points: float | None = None


class ActiveAttempt(AttemptSummary):
    status: Literal["ACTIVE"] = "ACTIVE"
    questions: list[ActiveQuestion]


class SubmittedAttempt(AttemptSummary):
    status: Literal["SUBMITTED"] = "SUBMITTED"
    questions: list[ResultQuestion]
    score: PaperScore | None = None
    self_review: SelfReviewSummary | None = None


class AbandonedAttempt(AttemptSummary):
    status: Literal["ABANDONED"] = "ABANDONED"
    abandoned_at: datetime
    questions: list[ActiveQuestion]


AttemptResponse = Annotated[
    ActiveAttempt | SubmittedAttempt | AbandonedAttempt, Field(discriminator="status")
]
