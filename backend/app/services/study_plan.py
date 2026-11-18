"""The study plan on request (#173): settings per student and course, and a deterministic plan.

Nothing scheduled is stored. The plan is recomputed on every read from the settings, the exam
cycle's date and units, the units' points on past papers and the student's accuracy (the 9c
estimate). The rule is written down in `docs/STUDY_PLAN.md`.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import User
from app.models.course_unit import CourseUnit
from app.models.exam_scope import ExamScope, ExamScopeUnit
from app.models.question import Question
from app.models.study_plan import StudyPlan
from app.models.user_question_progress import UserQuestionProgress
from app.schemas.study_plan import (
    PlanExam,
    PlanSettings,
    PlanSettingsUpdate,
    PlanToday,
    PlanTopic,
    PlanWeek,
    StudyPlanResponse,
    Work,
)
from app.services.course_dashboard import course_dashboard
from app.services.courses import get_member_course
from app.services.exam_estimate import scope_estimate

MAX_WEEKS = 12
# A mock exam in the exam week and every this many weeks before it.
MOCK_EVERY = 4
# Maintenance for mastered topics in the first week and every this many weeks after.
MAINTAIN_EVERY = 4
SECONDS_PER_QUESTION = 90
WEAK = 0.6
MASTERED = 0.8
DEFAULT_MINUTES = 40


@dataclass(frozen=True)
class TopicInput:
    unit_id: UUID
    title: str
    position: int
    exam_points: float
    accuracy: float | None


def state(topic: TopicInput) -> Work:
    if topic.accuracy is None:
        return "NEW"
    if topic.accuracy < WEAK:
        return "REVIEW"
    if topic.accuracy < MASTERED:
        return "PRACTICE"
    return "MAINTAIN"


def need(topic: TopicInput, equal_weight: bool) -> float:
    points = 1.0 if equal_weight else topic.exam_points
    return points * (1 - (topic.accuracy or 0.0))


def build_plan(
    today: date, exam_on: date, topics: list[TopicInput], daily_minutes: int, due_today: int
) -> tuple[list[PlanWeek], PlanToday, date | None, list[UUID]]:
    """Weeks from this week to the exam week (at most 12), today's work, the day the work weeks
    end, and the topics that did not fit. Pure: the same inputs give the same plan."""
    monday = today - timedelta(days=today.weekday())
    exam_monday = exam_on - timedelta(days=exam_on.weekday())
    weeks_total = max(1, min(MAX_WEEKS, (exam_monday - monday).days // 7 + 1))
    work_weeks = weeks_total - 1
    equal_weight = not any(topic.exam_points > 0 for topic in topics)

    def of(kind: Work) -> list[TopicInput]:
        return [topic for topic in topics if state(topic) == kind]

    queue = (
        sorted(of("REVIEW"), key=lambda t: (-need(t, equal_weight), t.position))
        + sorted(of("NEW"), key=lambda t: t.position)
        + sorted(of("PRACTICE"), key=lambda t: (-need(t, equal_weight), t.position))
    )
    total_need = sum(need(t, equal_weight) for t in queue) or 1.0
    assigned: list[list[PlanTopic]] = [[] for _ in range(weeks_total)]
    after: list[UUID] = []
    cursor = 0
    for topic in queue:
        if cursor >= work_weeks:
            after.append(topic.unit_id)
            continue
        share = max(1, round(need(topic, equal_weight) / total_need * work_weeks))
        end = min(work_weeks, cursor + share)
        for week in range(cursor, end):
            assigned[week].append(
                PlanTopic(unit_id=topic.unit_id, title=topic.title, work=state(topic))
            )
        cursor = end
    for topic in sorted(of("MAINTAIN"), key=lambda t: t.position):
        for week in range(0, weeks_total, MAINTAIN_EVERY):
            assigned[week].append(
                PlanTopic(unit_id=topic.unit_id, title=topic.title, work="MAINTAIN")
            )
    weeks = [
        PlanWeek(
            index=index,
            starts_on=monday + timedelta(weeks=index),
            topics=assigned[index],
            exam_week=index == weeks_total - 1,
            mock=(weeks_total - 1 - index) % MOCK_EVERY == 0,
        )
        for index in range(weeks_total)
    ]
    first = weeks[0]
    current = [topic for topic in first.topics if topic.work != "MAINTAIN"] or first.topics
    today_plan = PlanToday(
        topics=current,
        questions=max(1, daily_minutes * 60 // SECONDS_PER_QUESTION),
        due=due_today,
        mock=first.mock and first.exam_week,
    )
    covered_by = monday + timedelta(weeks=cursor) - timedelta(days=1) if cursor else None
    return weeks, today_plan, covered_by, after


def _settings(row: StudyPlan | None) -> PlanSettings:
    if row is None:
        return PlanSettings(
            exam_scope_id=None,
            target_points=None,
            daily_minutes=DEFAULT_MINUTES,
            plan_enabled=False,
        )
    return PlanSettings(
        exam_scope_id=row.exam_scope_id,
        target_points=float(row.target_points) if row.target_points is not None else None,
        daily_minutes=row.daily_minutes,
        plan_enabled=row.plan_enabled,
    )


def _scope(db: Session, course_id: UUID, chosen: UUID | None, today: date) -> ExamScope | None:
    """The chosen cycle when it has a date; otherwise the next dated one (as on Danas)."""
    if chosen is not None:
        scope = db.get(ExamScope, chosen)
        if scope is not None and scope.course_id == course_id and scope.starts_on is not None:
            return scope
    return db.scalar(
        select(ExamScope)
        .where(
            ExamScope.course_id == course_id,
            ExamScope.starts_on.is_not(None),
            func.coalesce(ExamScope.ends_on, ExamScope.starts_on) >= today,
        )
        .order_by(ExamScope.starts_on, ExamScope.name)
        .limit(1)
    )


def update_settings(
    db: Session, user: User, course_id: UUID, data: PlanSettingsUpdate
) -> PlanSettings:
    get_member_course(db, user, course_id)
    if data.exam_scope_id is not None:
        scope = db.get(ExamScope, data.exam_scope_id)
        if scope is None or scope.course_id != course_id:
            raise HTTPException(422, "The exam cycle is not part of this course")
    row = db.get(StudyPlan, (user.id, course_id))
    if row is None:
        row = StudyPlan(user_id=user.id, course_id=course_id)
        db.add(row)
    row.exam_scope_id = data.exam_scope_id
    row.target_points = None if data.target_points is None else Decimal(str(data.target_points))
    row.daily_minutes = data.daily_minutes
    row.plan_enabled = data.plan_enabled
    row.updated_at = datetime.now(UTC)
    db.commit()
    return _settings(row)


def _without_plan(settings: PlanSettings) -> StudyPlanResponse:
    return StudyPlanResponse(
        settings=settings, exam=None, weeks=[], today=None, covered_by=None, after_plan=[]
    )


def study_plan(db: Session, user: User, course_id: UUID) -> StudyPlanResponse:
    """The settings, and the plan when it is switched on and a dated exam cycle exists."""
    get_member_course(db, user, course_id)
    settings = _settings(db.get(StudyPlan, (user.id, course_id)))
    if not settings.plan_enabled:
        return _without_plan(settings)
    now = datetime.now(UTC)
    today = now.date()
    scope = _scope(db, course_id, settings.exam_scope_id, today)
    if scope is None or scope.starts_on is None:
        return _without_plan(settings)
    estimate = scope_estimate(db, user, scope.id)
    # The estimate covers the topics that carried points on past papers; the plan needs every
    # topic of the cycle, so the others take their latest result from the course dashboard.
    estimated = {topic.unit_id: topic for topic in estimate.topics}
    results = {unit.unit_id: unit for unit in course_dashboard(db, user, course_id).units}
    topics: list[TopicInput] = []
    for unit_id, title, position in db.execute(
        select(CourseUnit.id, CourseUnit.title, CourseUnit.position)
        .join(ExamScopeUnit, ExamScopeUnit.unit_id == CourseUnit.id)
        .where(ExamScopeUnit.scope_id == scope.id, CourseUnit.is_archived.is_(False))
        .order_by(CourseUnit.position, CourseUnit.id)
    ):
        known = estimated.get(unit_id)
        result = results.get(unit_id)
        accuracy = known.accuracy if known is not None else None
        if (
            accuracy is None
            and result is not None
            and result.attempts
            and result.last_percent is not None
        ):
            accuracy = result.last_percent / 100
        topics.append(
            TopicInput(unit_id, title, position, known.exam_points if known else 0.0, accuracy)
        )
    due = db.scalar(
        select(func.count())
        .select_from(UserQuestionProgress)
        .join(Question, Question.id == UserQuestionProgress.question_id)
        .where(
            UserQuestionProgress.user_id == user.id,
            Question.course_id == course_id,
            UserQuestionProgress.due_at <= now,
        )
    )
    weeks, today_plan, covered_by, after = build_plan(
        today, scope.starts_on, topics, settings.daily_minutes, due or 0
    )
    return StudyPlanResponse(
        settings=settings,
        exam=PlanExam(
            scope_id=scope.id,
            name=scope.name,
            starts_on=scope.starts_on,
            days=(scope.starts_on - today).days,
            estimate=estimate.estimate,
            max_points=estimate.max_points,
        ),
        weeks=weeks,
        today=today_plan,
        covered_by=covered_by,
        after_plan=after,
    )
