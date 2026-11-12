"""What the course list and the enrolment catalog show: question counts, mastery and the next exam.

Everything here is read-only and derived from stored data; no AI is involved. It lives apart from
`services.courses` because it uses `readiness`, which itself needs `services.courses`.
"""

from collections import defaultdict
from datetime import UTC, date, datetime
from typing import Literal, cast
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import and_, exists, func, select
from sqlalchemy.orm import Session

from app.models import Course, CourseMembership, User
from app.models.exam_scope import ExamScope
from app.models.faculty_moderator import FacultyModerator
from app.models.question import Question
from app.models.user_question_progress import UserQuestionProgress
from app.schemas.course import (
    EXAM_KINDS,
    CatalogCourseResponse,
    CourseResponse,
    MemberCourseResponse,
    MembershipStatus,
    NextExam,
)
from app.services.faculties import list_faculty_courses
from app.services.readiness import UNGRADED_TYPES, Review, is_retained

# The product is for students in Zagreb, so "today" for an exam countdown is a Zagreb date.
EXAM_TIMEZONE = ZoneInfo("Europe/Zagreb")


def zagreb_today() -> date:
    return datetime.now(EXAM_TIMEZONE).date()


def approved_question_counts(db: Session, course_ids: list[UUID]) -> dict[UUID, int]:
    """Questions students can practise, per course; courses without any are absent."""
    if not course_ids:
        return {}
    rows = db.execute(
        select(Question.course_id, func.count())
        .where(Question.course_id.in_(course_ids), Question.status == "APPROVED")
        .group_by(Question.course_id)
    )
    return {course_id: count for course_id, count in rows}


def percent_half_up(part: int, whole: int) -> int:
    """`part` of `whole` as a whole percent, rounded half up: 1 of 8 is 13 %, not the 12 % that
    banker's rounding would give."""
    return (200 * part + whole) // (2 * whole)


def mastery_percentages(
    db: Session, user: User, course_ids: list[UUID], as_of: datetime
) -> dict[UUID, int | None]:
    """Per course, the share of gradable approved questions the user still retains.

    It uses the retention proxy of `readiness-v1`: the last answer was correct and the question is
    not overdue by more than its own interval. A course without gradable approved questions maps to
    None; a course the user has not started maps to 0. The share is rounded half up.
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
            select(Question.course_id, func.count()).where(*gradable).group_by(Question.course_id)
        )
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
    )
    for course_id, stage, result, due_at, answers, correct in rows:
        retained[course_id] += is_retained(Review(stage, result, due_at, answers, correct), as_of)
    percentages: dict[UUID, int | None] = {}
    for course_id in course_ids:
        total = totals.get(course_id, 0)
        percentages[course_id] = percent_half_up(retained[course_id], total) if total else None
    return percentages


def next_exams(db: Session, course_ids: list[UUID], today: date) -> dict[UUID, NextExam]:
    """The nearest dated exam per course whose last day is `today` or later."""
    if not course_ids:
        return {}
    last_day = func.coalesce(ExamScope.ends_on, ExamScope.starts_on)
    scopes = db.scalars(
        select(ExamScope)
        .where(
            ExamScope.course_id.in_(course_ids),
            ExamScope.kind.in_(EXAM_KINDS),
            ExamScope.starts_on.is_not(None),
            last_day >= today,
        )
        .order_by(ExamScope.course_id, ExamScope.starts_on, ExamScope.id)
    )
    nearest: dict[UUID, NextExam] = {}
    for scope in scopes:
        if scope.course_id not in nearest and scope.starts_on is not None:
            nearest[scope.course_id] = NextExam(
                scope_id=scope.id,
                kind=scope.kind,  # type: ignore[arg-type]  # narrowed by the EXAM_KINDS filter
                name=scope.name,
                starts_on=scope.starts_on,
                ends_on=scope.ends_on,
            )
    return nearest


def list_member_courses(
    db: Session, user: User, today: date | None = None, as_of: datetime | None = None
) -> list[MemberCourseResponse]:
    """The user's courses, whatever their list status, with the numbers the cards show."""
    rows = db.execute(
        select(Course, CourseMembership.role, CourseMembership.status)
        .join(CourseMembership)
        .where(CourseMembership.user_id == user.id)
    ).all()
    course_ids = [course.id for course, _, _ in rows]
    counts = approved_question_counts(db, course_ids)
    mastery = mastery_percentages(db, user, course_ids, as_of or datetime.now(UTC))
    exams = next_exams(db, course_ids, today or zagreb_today())
    return [
        MemberCourseResponse(
            **CourseResponse.model_validate(course).model_dump(),
            role=cast(Literal["OWNER", "MEMBER"], role),  # the column holds one of the two
            membership_status=cast(
                MembershipStatus, membership_status
            ),  # the column is constrained
            approved_question_count=counts.get(course.id, 0),
            mastery_percent=mastery[course.id],
            next_exam=exams.get(course.id),
        )
        for course, role, membership_status in rows
    ]


def list_catalog_courses(
    db: Session, faculty_id: UUID, limit: int, offset: int
) -> list[CatalogCourseResponse]:
    courses = list_faculty_courses(db, faculty_id, limit, offset)
    counts = approved_question_counts(db, [course.id for course in courses])
    has_moderators = bool(
        db.scalar(select(exists().where(FacultyModerator.faculty_id == faculty_id)))
    )
    return [
        CatalogCourseResponse(
            **CourseResponse.model_validate(course).model_dump(),
            approved_question_count=counts.get(course.id, 0),
            has_moderators=has_moderators,
        )
        for course in courses
    ]
