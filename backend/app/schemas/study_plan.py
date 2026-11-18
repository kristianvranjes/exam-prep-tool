from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.exam_estimate import PointsRange
from app.schemas.question import StrictModel

# The kind of work on a topic in a week: a new topic, review of a weak one (< 60 %), practice
# (60-80 %) or maintenance of a mastered one (>= 80 %).
Work = Literal["NEW", "REVIEW", "PRACTICE", "MAINTAIN"]


class PlanSettings(BaseModel):
    exam_scope_id: UUID | None
    target_points: float | None
    daily_minutes: int
    plan_enabled: bool


class PlanSettingsUpdate(StrictModel):
    exam_scope_id: UUID | None = None
    target_points: float | None = Field(default=None, gt=0, le=1000)
    daily_minutes: int = Field(default=40, ge=10, le=240)
    plan_enabled: bool = False


class PlanTopic(BaseModel):
    unit_id: UUID
    title: str
    work: Work


class PlanWeek(BaseModel):
    index: int
    # Monday of the week.
    starts_on: date
    topics: list[PlanTopic]
    exam_week: bool
    mock: bool


class PlanToday(BaseModel):
    topics: list[PlanTopic]
    # Questions for the day: daily minutes at about 90 seconds a question.
    questions: int
    # Review cards due now in this course.
    due: int
    mock: bool


class PlanExam(BaseModel):
    scope_id: UUID
    name: str
    starts_on: date
    days: int
    estimate: PointsRange | None
    max_points: float | None


class StudyPlanResponse(BaseModel):
    settings: PlanSettings
    # Null while the plan is off or no dated exam cycle exists; then the lists are empty.
    exam: PlanExam | None
    weeks: list[PlanWeek]
    today: PlanToday | None
    # The last day of the work weeks: "uz plan, sve teme prijeđene do".
    covered_by: date | None
    # Topics that did not fit before the exam week.
    after_plan: list[UUID]
