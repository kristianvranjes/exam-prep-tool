from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from app.schemas.course_unit import CourseUnitResponse, UnitPerson, UnitStatus
from app.schemas.question import OwnerQuestion, QuestionStatus, QuestionType, StrictModel


class UnitStatusChange(StrictModel):
    status: UnitStatus


class UnitModerationRow(CourseUnitResponse):
    """A unit (quiz) with what a moderator needs on the list of quizzes."""

    # Questions of the unit that are not archived, by state.
    question_count: int = 0
    draft_count: int = 0
    rejected_count: int = 0
    pending_review_count: int = 0
    without_explanation_count: int = 0
    open_report_count: int = 0
    open_suggestion_count: int = 0
    # The latest change of the unit itself or of any of its questions.
    last_changed_at: datetime


class UnitQuestionRow(BaseModel):
    id: UUID
    type: QuestionType
    status: QuestionStatus
    source: str
    stem: str
    difficulty: int | None
    has_explanation: bool
    author: UnitPerson | None
    open_report_count: int
    open_suggestion_count: int
    updated_at: datetime


class UnitModerationDetail(BaseModel):
    unit: UnitModerationRow
    questions: list[UnitQuestionRow]


class ModerationCounts(BaseModel):
    pending_questions: int
    open_reports: int
    open_suggestions: int
    pending_units: int


class ReviewQuestion(OwnerQuestion):
    """A question in the review queue, with who wrote it and who reviewed it."""

    author_name: str | None = None
    reviewer_name: str | None = None


TableFilter = Literal["ALL", "REPORTED", "LOW_ACCURACY"]


class QuestionTableRow(BaseModel):
    """A question on the manager's bank table (23b)."""

    id: UUID
    type: QuestionType
    status: QuestionStatus
    stem: str
    # Its units: a unit is a quiz, so this is also the quizzes it is in.
    unit_ids: list[UUID]
    open_report_count: int
    # Graded answers (correct or incorrect) in submitted sessions, and the share correct;
    # the share is null below `QuestionTable.min_answers`.
    answer_count: int
    accuracy: float | None
    updated_at: datetime


class TopicCount(BaseModel):
    unit_id: UUID | None
    count: int


class QuestionTable(BaseModel):
    rows: list[QuestionTableRow]
    # Rows matching the filters, for paging.
    total: int
    # Questions of the course that are not archived, whatever the filters.
    question_count: int
    # Questions that are not archived per unit, and without a unit (`unit_id` null).
    topics: list[TopicCount]
    min_answers: int
