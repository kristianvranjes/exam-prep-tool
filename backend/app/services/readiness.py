"""Deterministic exam readiness for one exam scope (`readiness-v1`).

Built only from the caller's stored `leitner-v1` review progress: no AI calls and no
writes. FSRS retrievability will replace the retention proxy once `fsrs-v1` exists.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from math import sqrt
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models import User
from app.models.course_unit import CourseUnit, QuestionUnit
from app.models.exam_scope import ExamScope, ExamScopeUnit
from app.models.question import Question
from app.models.user_question_progress import UserQuestionProgress
from app.schemas.readiness import (
    ExamScopeReadiness,
    ReadinessRange,
    ReadinessRule,
    UnitReadiness,
)
from app.services.courses import get_member_course
from app.services.scheduling import DELAYS

RULE: ReadinessRule = "readiness-v1"
# Two-sided 90 % Wilson score interval.
Z = 1.645
MIN_ANSWERED = 10
WEAKEST = 3
# Short answers are self-reviewed and never stored as graded reviews, so they could never
# count as answered.
UNGRADED_TYPES = ("SHORT_ANSWER",)


@dataclass(frozen=True)
class Review:
    review_stage: int
    last_result: str
    due_at: datetime
    resolved_review_count: int
    correct_review_count: int


@dataclass(frozen=True)
class Tally:
    questions: int = 0
    answered: int = 0
    retained: int = 0
    answers: int = 0
    correct_answers: int = 0


def is_retained(review: Review, as_of: datetime) -> bool:
    """The retention proxy: the last answer was correct and the question has not been
    overdue for longer than its own leitner-v1 interval."""
    interval = DELAYS[review.review_stage]
    return review.last_result == "CORRECT" and as_of < review.due_at + interval


def tally(reviews: Iterable[Review | None], as_of: datetime) -> Tally:
    """Count one entry per question; None is a question without a graded answer."""
    questions = answered = retained = answers = correct = 0
    for review in reviews:
        questions += 1
        if review is None:
            continue
        answered += 1
        retained += is_retained(review, as_of)
        answers += review.resolved_review_count
        correct += review.correct_review_count
    return Tally(questions, answered, retained, answers, correct)


def wilson(successes: int, trials: int) -> tuple[float, float]:
    """Wilson score interval; without trials the share could be anything."""
    if trials == 0:
        return 0.0, 1.0
    share = successes / trials
    spread = Z * Z / trials
    centre = (share + spread / 2) / (1 + spread)
    margin = Z * sqrt(share * (1 - share) / trials + spread / (4 * trials)) / (1 + spread)
    return max(0.0, centre - margin), min(1.0, centre + margin)


def readiness_range(tallies: Iterable[Tally]) -> ReadinessRange | None:
    """Answered questions count as they stand: retained or not. Unanswered ones count at
    the Wilson bounds of their unit's retention, so few answers widen the range and an
    untouched unit spans 0 to 1. Units are weighted by question count."""
    total = low = high = 0.0
    for unit in tallies:
        lower, upper = wilson(unit.retained, unit.answered)
        unanswered = unit.questions - unit.answered
        total += unit.questions
        low += unit.retained + unanswered * lower
        high += unit.retained + unanswered * upper
    if not total:
        return None
    return ReadinessRange(low=round(low / total, 4), high=round(high / total, 4))


def ratio(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def weakest(units: list[UnitReadiness]) -> list[UUID]:
    """Lowest lower bound first, so weak results and missing evidence both rank low.

    Archived units cannot be chosen in practice setup and fully retained units have
    nothing left to practise, so neither is suggested.
    """
    ranked = sorted(
        (unit.readiness.low, unit.readiness.high, unit.position, str(unit.unit_id), unit.unit_id)
        for unit in units
        if unit.readiness and not unit.is_archived and unit.retained_count < unit.question_count
    )
    return [row[-1] for row in ranked[:WEAKEST]]


def scope_readiness(db: Session, user: User, scope_id: UUID) -> ExamScopeReadiness:
    course_id = db.scalar(select(ExamScope.course_id).where(ExamScope.id == scope_id))
    if course_id is None:
        raise HTTPException(404, "Exam scope not found")
    get_member_course(db, user, course_id)
    as_of = datetime.now(UTC)
    units = db.execute(
        select(CourseUnit.id, CourseUnit.title, CourseUnit.position, CourseUnit.is_archived)
        .join(ExamScopeUnit, ExamScopeUnit.unit_id == CourseUnit.id)
        .where(ExamScopeUnit.scope_id == scope_id)
        .order_by(CourseUnit.position, CourseUnit.id)
    ).all()
    progress = UserQuestionProgress
    rows = db.execute(
        select(
            QuestionUnit.unit_id,
            Question.id,
            progress.review_stage,
            progress.last_result,
            progress.due_at,
            progress.resolved_review_count,
            progress.correct_review_count,
        )
        .join(ExamScopeUnit, ExamScopeUnit.unit_id == QuestionUnit.unit_id)
        .join(Question, Question.id == QuestionUnit.question_id)
        .outerjoin(progress, and_(progress.question_id == Question.id, progress.user_id == user.id))
        .where(
            ExamScopeUnit.scope_id == scope_id,
            Question.course_id == course_id,
            # The shared bank every member may practise, like the scope's coverage.
            Question.status == "APPROVED",
            Question.type.not_in(UNGRADED_TYPES),
        )
    ).all()
    by_unit: dict[UUID, list[Review | None]] = {unit.id: [] for unit in units}
    by_question: dict[UUID, Review | None] = {}
    for unit_id, question_id, stage, result, due_at, answers, correct in rows:
        review = None if due_at is None else Review(stage, result, due_at, answers, correct)
        by_unit[unit_id].append(review)
        by_question[question_id] = review
    tallies = {unit_id: tally(reviews, as_of) for unit_id, reviews in by_unit.items()}
    unit_rows = []
    for unit in units:
        counts = tallies[unit.id]
        unit_rows.append(
            UnitReadiness(
                unit_id=unit.id,
                title=unit.title,
                position=unit.position,
                is_archived=unit.is_archived,
                question_count=counts.questions,
                answered_count=counts.answered,
                retained_count=counts.retained,
                answer_count=counts.answers,
                correct_answer_count=counts.correct_answers,
                coverage=ratio(counts.answered, counts.questions),
                accuracy=ratio(counts.correct_answers, counts.answers),
                retention=ratio(counts.retained, counts.answered),
                readiness=readiness_range([counts]),
            )
        )
    scope = tally(by_question.values(), as_of)
    needed = min(MIN_ANSWERED, scope.questions)
    enough = scope.questions > 0 and scope.answered >= needed
    return ExamScopeReadiness(
        scope_id=scope_id,
        rule=RULE,
        as_of=as_of,
        question_count=scope.questions,
        answered_count=scope.answered,
        retained_count=scope.retained,
        answer_count=scope.answers,
        correct_answer_count=scope.correct_answers,
        min_answered=needed,
        readiness=readiness_range(tallies.values()) if enough else None,
        units=unit_rows,
        weakest_unit_ids=weakest(unit_rows),
    )
