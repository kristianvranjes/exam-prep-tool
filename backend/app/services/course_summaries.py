"""What the course cards and the catalog show: question counts, mastery and the next exam.

Everything here is read-only and derived from stored data; no AI is involved.
"""

from collections import defaultdict
from datetime import UTC, date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.models import Course, CourseMembership, User
from app.models.exam_scope import ExamScope
from app.models.question import Question
from app.models.user_question_progress import UserQuestionProgress
from app.schemas.course import CourseListItem, CourseResponse, NextExam
from app.services.readiness import UNGRADED_TYPES, Review, is_retained

# The product is for FER students, so "today" for an exam countdown is a Zagreb date.
EXAM_TIMEZONE = ZoneInfo("Europe/Zagreb")


def zagreb_today() -> date:
    return datetime.now(EXAM_TIMEZONE).date()


def approved_counts(db: Session, course_ids: list[UUID]) -> dict[UUID, int]:
    """Approved questions per course: the shared bank every member may practise."""
    if not course_ids:
        return {}
    rows = db.execute(
        select(Question.course_id, func.count(Question.id))
        .where(Question.course_id.in_(course_ids), Question.status == "APPROVED")
        .group_by(Question.course_id)
    ).all()
    return {course_id: count for course_id, count in rows}


def mastery_percentages(
    db: Session, user: User, course_ids: list[UUID], as_of: datetime
) -> dict[UUID, int | None]:
    """Per course, the share of gradable approved questions the user still retains.

    Uses the retention proxy of `readiness-v1`: the last answer was correct and the question
    is not overdue by more than its own interval. Courses without gradable approved questions
    map to None; a course the user has not started maps to 0.
    """
    if not course_ids:
        return {}
    gradable = (
        Question.course_id.in_(course_ids),
        Question.status == "APPROVED",
        Question.type.not_in(UNGRADED_TYPES),
    )
    totals = {
        course_id: count
        for course_id, count in db.execute(
            select(Question.course_id, func.count(Question.id))
            .where(*gradable)
            .group_by(Question.course_id)
        ).all()
    }
    progress = UserQuestionProgress
    retained: dict[UUID, int] = defaultdict(int)
    rows = db.execute(
        select(
            Question.course_id,
            progress.review_stage,
            progress.last_result,
            progress.due_at,
            progress.resolved_review_count,
            progress.correct_review_count,
        )
        .join(progress, and_(progress.question_id == Question.id, progress.user_id == user.id))
        .where(*gradable)
    ).all()
    for course_id, stage, result, due_at, answers, correct in rows:
        retained[course_id] += is_retained(Review(stage, result, due_at, answers, correct), as_of)
    percentages: dict[UUID, int | None] = {}
    for course_id in course_ids:
        total = totals.get(course_id, 0)
        # Round half up so 1 of 8 reads 13 %, not the banker's 12 %.
        percentages[course_id] = (
            (200 * retained[course_id] + total) // (2 * total) if total else None
        )
    return percentages


def next_exams(db: Session, course_ids: list[UUID], today: date) -> dict[UUID, NextExam]:
    """The dated exam cycle in progress or coming next; undated cycles are ignored."""
    if not course_ids:
        return {}
    scopes = db.scalars(
        select(ExamScope)
        .where(
            ExamScope.course_id.in_(course_ids),
            ExamScope.starts_on.is_not(None),
            func.coalesce(ExamScope.ends_on, ExamScope.starts_on) >= today,
        )
        .order_by(ExamScope.starts_on, ExamScope.name, ExamScope.id)
    )
    found: dict[UUID, NextExam] = {}
    for scope in scopes:
        if scope.course_id not in found and scope.starts_on is not None:
            found[scope.course_id] = NextExam(
                scope_id=scope.id,
                name=scope.name,
                kind=scope.kind,
                starts_on=scope.starts_on,
                ends_on=scope.ends_on,
            )
    return found


def list_course_items(
    db: Session, user: User, today: date | None = None, as_of: datetime | None = None
) -> list[CourseListItem]:
    """The user's courses, active and finished, with the numbers the cards show."""
    rows = db.execute(
        select(Course, CourseMembership.role, CourseMembership.status)
        .join(CourseMembership, CourseMembership.course_id == Course.id)
        .where(CourseMembership.user_id == user.id)
        .order_by(Course.name, Course.id)
    ).all()
    course_ids = [course.id for course, _, _ in rows]
    counts = approved_counts(db, course_ids)
    mastery = mastery_percentages(db, user, course_ids, as_of or datetime.now(UTC))
    exams = next_exams(db, course_ids, today or zagreb_today())
    return [
        CourseListItem(
            **CourseResponse.model_validate(course).model_dump(),
            role=role,
            status=status,
            approved_question_count=counts.get(course.id, 0),
            mastery_percent=mastery[course.id],
            next_exam=exams.get(course.id),
        )
        for course, role, status in rows
    ]
