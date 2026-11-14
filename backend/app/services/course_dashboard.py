"""Results the course page and the progress screen show: per unit, per session and per week.

Read-only and derived from submitted sessions; no AI is involved. Only automatically graded answers
count (`CORRECT` / `INCORRECT`): a short answer awaiting review is never a grade, and a self-review
never changes one. Abandoned and unfinished sessions are ignored.
"""

from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any, cast
from uuid import UUID

from sqlalchemy import Select, and_, func, select
from sqlalchemy.orm import Session

from app.models import User
from app.models.course_unit import CourseUnit, QuestionUnit
from app.models.question import Question
from app.models.quiz import Answer, Quiz, QuizAttempt, QuizQuestion
from app.models.user_question_progress import UserQuestionProgress
from app.schemas.dashboard import (
    CourseDashboard,
    LastMock,
    ProgressSeries,
    UnitResult,
    UnitSeries,
    WeekCell,
)
from app.schemas.quiz import Grade
from app.services.course_summaries import EXAM_TIMEZONE, percent_half_up, zagreb_today
from app.services.courses import get_member_course
from app.services.paper_scoring import ItemResult, score

GRADED = ("CORRECT", "INCORRECT")


def week_start(moment: datetime) -> date:
    """The Monday of the week `moment` falls in, in Zagreb time."""
    local = moment.astimezone(EXAM_TIMEZONE).date()
    return local - timedelta(days=local.weekday())


def _graded_answers(user: User, course_id: UUID, *columns: Any) -> Select[Any]:
    """Graded answers of the caller's submitted sessions in a course, with `columns` selected."""
    return (
        select(*columns)
        .select_from(Answer)
        .join(QuizAttempt, QuizAttempt.id == Answer.attempt_id)
        .join(Quiz, Quiz.id == QuizAttempt.quiz_id)
        .join(QuizQuestion, QuizQuestion.id == Answer.quiz_question_id)
        .where(
            Quiz.user_id == user.id,
            Quiz.course_id == course_id,
            QuizAttempt.status == "SUBMITTED",
            Answer.grading_status.in_(GRADED),
        )
    )


def _in_units(statement: Select[Any]) -> Select[Any]:
    """Adds the units each answered question is currently linked to; a question in two units appears
    once per unit."""
    return statement.join(QuestionUnit, QuestionUnit.question_id == QuizQuestion.source_question_id)


def _active_units(db: Session, course_id: UUID) -> list[CourseUnit]:
    return list(
        db.scalars(
            select(CourseUnit)
            .where(CourseUnit.course_id == course_id, CourseUnit.is_archived.is_(False))
            .order_by(CourseUnit.position, CourseUnit.id)
        )
    )


def course_dashboard(db: Session, user: User, course_id: UUID) -> CourseDashboard:
    get_member_course(db, user, course_id)
    units = _active_units(db, course_id)
    correct = Answer.grading_status == "CORRECT"

    # Overall result per session, counting each answer once however many units its question has.
    overall: Sequence[Any] = db.execute(
        _graded_answers(
            user, course_id, Answer.attempt_id, func.count(), func.count().filter(correct)
        ).group_by(Answer.attempt_id)
    ).all()
    session_percents = [percent_half_up(right, graded) for _, graded, right in overall]
    # The mean of the whole percents, rounded half up.
    average = (
        (2 * sum(session_percents) + len(session_percents)) // (2 * len(session_percents))
        if session_percents
        else None
    )

    # Per unit and session: correct of graded, ordered by when the session was submitted.
    rows: Sequence[Any] = db.execute(
        _in_units(
            _graded_answers(
                user,
                course_id,
                QuestionUnit.unit_id,
                Answer.attempt_id,
                QuizAttempt.submitted_at,
                func.count(),
                func.count().filter(correct),
            )
        ).group_by(QuestionUnit.unit_id, Answer.attempt_id, QuizAttempt.submitted_at)
    ).all()
    sessions: dict[UUID, list[tuple[datetime, str, int]]] = defaultdict(list)
    for unit_id, attempt_id, moment, graded, right in rows:
        sessions[unit_id].append((moment, str(attempt_id), percent_half_up(right, graded)))

    # Questions answered and graded at least once, per unit (one in two units counts twice).
    answered: dict[UUID, int] = {
        unit_id: count
        for unit_id, count in db.execute(
            select(
                QuestionUnit.unit_id, func.count(func.distinct(UserQuestionProgress.question_id))
            )
            .select_from(UserQuestionProgress)
            .join(Question, Question.id == UserQuestionProgress.question_id)
            .join(QuestionUnit, QuestionUnit.question_id == Question.id)
            .where(UserQuestionProgress.user_id == user.id, Question.course_id == course_id)
            .group_by(QuestionUnit.unit_id)
        ).all()
    }
    results: list[UnitResult] = []
    for unit in units:
        percents = [percent for _, _, percent in sorted(sessions.get(unit.id, []))]
        results.append(
            UnitResult(
                unit_id=unit.id,
                title=unit.title,
                position=unit.position,
                attempts=len(percents),
                best_percent=max(percents) if percents else None,
                last_percent=percents[-1] if percents else None,
                answered_questions=answered.get(unit.id, 0),
            )
        )
    return CourseDashboard(
        as_of=datetime.now(UTC),
        units_total=len(units),
        units_attempted=sum(1 for result in results if result.attempts),
        average_percent=average,
        units=results,
        last_mock=last_mock(db, user, course_id),
    )


def last_mock(db: Session, user: User, course_id: UUID) -> LastMock | None:
    """The caller's latest submitted scored mock exam, with the points it earned."""
    latest = db.execute(
        select(QuizAttempt.id, QuizAttempt.submitted_at, Quiz.scoring)
        .join(Quiz, Quiz.id == QuizAttempt.quiz_id)
        .where(
            Quiz.user_id == user.id,
            Quiz.course_id == course_id,
            Quiz.selection_mode == "MOCK",
            Quiz.scoring.is_not(None),
            QuizAttempt.status == "SUBMITTED",
        )
        .order_by(QuizAttempt.submitted_at.desc(), QuizAttempt.id)
        .limit(1)
    ).first()
    if latest is None:
        return None
    attempt_id, submitted_at, scoring = latest
    assert scoring is not None and submitted_at is not None
    rows = db.execute(
        select(QuizQuestion.points, Answer.grading_status)
        .select_from(QuizQuestion)
        .join(QuizAttempt, QuizAttempt.quiz_id == QuizQuestion.quiz_id)
        .outerjoin(
            Answer,
            and_(Answer.attempt_id == QuizAttempt.id, Answer.quiz_question_id == QuizQuestion.id),
        )
        .where(QuizAttempt.id == attempt_id, QuizQuestion.points.is_not(None))
    ).all()
    result = score(
        [
            ItemResult(points, cast(Grade | None, grade))
            for points, grade in rows
            if points is not None
        ],
        Decimal(str(scoring["wrong_answer_penalty"])),
        None,
    )
    return LastMock(
        attempt_id=attempt_id,
        title=str(scoring["title"]),
        earned=float(result.earned),
        max_points=float(result.max_points),
        submitted_at=submitted_at,
    )


def progress_series(
    db: Session, user: User, course_id: UUID, weeks: int, today: date | None = None
) -> ProgressSeries:
    get_member_course(db, user, course_id)
    today = today or zagreb_today()
    this_monday = today - timedelta(days=today.weekday())
    mondays = [this_monday - timedelta(weeks=offset) for offset in range(weeks - 1, -1, -1)]
    index = {monday: position for position, monday in enumerate(mondays)}
    window_start = datetime.combine(mondays[0], datetime.min.time(), tzinfo=EXAM_TIMEZONE)

    rows: Sequence[Any] = db.execute(
        _in_units(
            _graded_answers(
                user,
                course_id,
                QuestionUnit.unit_id,
                QuizAttempt.submitted_at,
                Answer.grading_status,
            )
        ).where(QuizAttempt.submitted_at >= window_start)
    ).all()
    totals: dict[tuple[UUID, int], list[int]] = defaultdict(lambda: [0, 0])
    for unit_id, moment, status in rows:
        position = index.get(week_start(moment))
        if position is None:  # a session submitted after today's week (clock skew)
            continue
        cell = totals[(unit_id, position)]
        cell[0] += 1
        cell[1] += status == "CORRECT"

    series: list[UnitSeries] = []
    for unit in _active_units(db, course_id):
        cells = []
        for position in range(len(mondays)):
            graded, right = totals.get((unit.id, position), (0, 0))
            cells.append(
                WeekCell(
                    percent=percent_half_up(right, graded) if graded else None,
                    graded_count=graded,
                )
            )
        series.append(
            UnitSeries(unit_id=unit.id, title=unit.title, position=unit.position, cells=cells)
        )
    return ProgressSeries(weeks=mondays, units=series)
