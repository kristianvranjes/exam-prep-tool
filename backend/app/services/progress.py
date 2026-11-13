from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from app.models import User
from app.models.course_unit import CourseUnit, QuestionUnit
from app.models.question import Question
from app.models.user_question_progress import ReviewRatingEvent, UserQuestionProgress
from app.schemas.progress import (
    ForecastDay,
    ProgressResponse,
    ProgressSummary,
    ReviewForecast,
    ReviewRatingResult,
    StageCount,
    UnitProgress,
    UnitProgressSummary,
)
from app.schemas.quiz import Grade
from app.services.courses import get_member_course
from app.services.practice_eligibility import practice_eligible
from app.services.scheduling import (
    SRS_VERSION,
    Rating,
    rating_for_result,
    schedule,
    schedule_rating,
)


def apply_reviews(
    db: Session, user_id: UUID, results: dict[UUID, Grade], submitted_at: datetime
) -> None:
    """Mutate inside submit's transaction, after it has locked the user row.

    Source key locks protect against deletion, without reading live grading data.
    Deleted sources are skipped: their snapshots still grade and remain historical.
    """
    resolved = {qid: result for qid, result in results.items() if result != "PENDING"}
    if not resolved:
        return
    sources = list(
        db.scalars(
            select(Question.id)
            .where(Question.id.in_(resolved))
            .order_by(Question.id)
            .with_for_update(read=True, key_share=True)
        )
    )
    existing = {
        row.question_id: row
        for row in db.scalars(
            select(UserQuestionProgress)
            .where(
                UserQuestionProgress.user_id == user_id,
                UserQuestionProgress.question_id.in_(sources),
            )
            .execution_options(populate_existing=True)
        )
    }
    exams = _exam_starts(db, sources)
    for question_id in sources:
        result = resolved[question_id]
        row = existing.get(question_id)
        previous_version = row.scheduling_version if row is not None else None
        transition = schedule(row.review_stage if row else 0, result, submitted_at)
        assert transition is not None
        if row is None:
            row = UserQuestionProgress(
                user_id=user_id,
                question_id=question_id,
                resolved_review_count=0,
                correct_review_count=0,
                incorrect_review_count=0,
                created_at=submitted_at,
            )
            db.add(row)
        row.review_stage = transition.review_stage
        row.due_at = transition.due_at
        row.scheduling_version = transition.scheduling_version
        if previous_version == SRS_VERSION:
            # A card already on rating-based scheduling stays on it: a graded answer counts as
            # GOOD or AGAIN, with the same intervals and exam-day cap as an explicit rating.
            rating = rating_for_result(result)
            assert rating is not None
            rated = schedule_rating(
                row.interval_minutes,
                row.repetitions,
                row.lapses,
                rating,
                submitted_at,
                exams.get(question_id),
            )
            row.due_at = rated.due_at
            row.interval_minutes = rated.interval_minutes
            row.repetitions = rated.repetitions
            row.lapses = rated.lapses
            row.last_rating = rating
            row.scheduling_version = rated.scheduling_version
        row.resolved_review_count += 1
        row.correct_review_count += int(result == "CORRECT")
        row.incorrect_review_count += int(result == "INCORRECT")
        row.last_result = result
        row.last_reviewed_at = submitted_at
        row.updated_at = submitted_at


def _exam_starts(db: Session, question_ids: list[UUID]) -> dict[UUID, date]:
    """The start of each question's course's next exam, for the cap on review due times."""
    # Imported here: course_summaries needs services that themselves import this module.
    from app.services.course_summaries import next_exams, zagreb_today

    rows = db.execute(
        select(Question.id, Question.course_id).where(Question.id.in_(question_ids))
    ).all()
    exams = next_exams(db, list({course_id for _, course_id in rows}), zagreb_today())
    return {
        question_id: exams[course_id].starts_on
        for question_id, course_id in rows
        if course_id in exams
    }


def apply_rating(
    db: Session,
    user: User,
    course_id: UUID,
    question_id: UUID,
    rating: Rating,
    rated_at: datetime | None = None,
) -> ReviewRatingResult:
    """Reschedule a card by the student's own rating (srs-v2).

    Only a question the user has already answered in this course can be rated: its card comes
    from that answer. A rating changes the schedule fields only; the answer counts, the stage and
    the last result stay as grading left them, so nothing is counted twice.
    """
    get_member_course(db, user, course_id)
    rated_at = rated_at or datetime.now(UTC)
    row = db.scalar(
        select(UserQuestionProgress)
        .join(Question, Question.id == UserQuestionProgress.question_id)
        .where(
            UserQuestionProgress.user_id == user.id,
            UserQuestionProgress.question_id == question_id,
            Question.course_id == course_id,
        )
        .with_for_update()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No review card for this question")
    rated = schedule_rating(
        row.interval_minutes,
        row.repetitions,
        row.lapses,
        rating,
        rated_at,
        _exam_starts(db, [question_id]).get(question_id),
    )
    row.due_at = rated.due_at
    row.interval_minutes = rated.interval_minutes
    row.repetitions = rated.repetitions
    row.lapses = rated.lapses
    row.last_rating = rating
    row.scheduling_version = rated.scheduling_version
    row.updated_at = rated_at
    db.add(
        ReviewRatingEvent(
            user_id=user.id,
            question_id=question_id,
            rating=rating,
            rated_at=rated_at,
            interval_minutes=rated.interval_minutes,
            due_at=rated.due_at,
            scheduling_version=rated.scheduling_version,
        )
    )
    db.commit()
    return ReviewRatingResult(
        question_id=question_id,
        rating=rating,
        interval_minutes=rated.interval_minutes,
        due_at=rated.due_at,
        repetitions=rated.repetitions,
        lapses=rated.lapses,
        scheduling_version=rated.scheduling_version,
    )


def list_progress(
    db: Session, user: User, course_id: UUID, limit: int, offset: int
) -> list[ProgressResponse]:
    get_member_course(db, user, course_id)
    progress = UserQuestionProgress
    actionable = practice_eligible(user.id).label("is_actionable")
    rows = db.execute(
        select(
            progress.question_id,
            actionable,
            progress.review_stage,
            progress.resolved_review_count,
            progress.correct_review_count,
            progress.incorrect_review_count,
            progress.last_result,
            progress.last_reviewed_at,
            progress.due_at,
        )
        .join(Question)
        .where(progress.user_id == user.id, Question.course_id == course_id)
        .order_by(actionable.desc(), progress.due_at, progress.question_id)
        .limit(limit)
        .offset(offset)
    ).mappings()
    return [ProgressResponse.model_validate(row) for row in rows]


def summarize_progress(db: Session, user: User, course_id: UUID) -> ProgressSummary:
    get_member_course(db, user, course_id)
    as_of = datetime.now(UTC)
    progress = UserQuestionProgress
    scope = (progress.user_id == user.id, Question.course_id == course_id)
    actionable = practice_eligible(user.id)
    totals = db.execute(
        select(
            func.count(progress.id),
            func.coalesce(func.sum(case((actionable & (progress.due_at <= as_of), 1), else_=0)), 0),
            func.coalesce(func.sum(case((actionable & (progress.due_at > as_of), 1), else_=0)), 0),
            func.coalesce(func.sum(progress.resolved_review_count), 0),
            func.coalesce(func.sum(progress.correct_review_count), 0),
            func.coalesce(func.sum(progress.incorrect_review_count), 0),
            func.max(progress.last_reviewed_at),
            func.min(case((actionable, progress.due_at), else_=None)),
        )
        .select_from(progress)
        .join(Question)
        .where(*scope)
    ).one()
    counts: dict[int, int] = {
        stage: count
        for stage, count in db.execute(
            select(progress.review_stage, func.count(progress.id))
            .join(Question)
            .where(*scope)
            .group_by(progress.review_stage)
        ).all()
    }
    return ProgressSummary(
        as_of=as_of,
        reviewed_questions=totals[0],
        due_now=totals[1],
        upcoming=totals[2],
        resolved_review_count=totals[3],
        correct_review_count=totals[4],
        incorrect_review_count=totals[5],
        last_reviewed_at=totals[6],
        next_due_at=totals[7],
        stage_counts=[
            StageCount(review_stage=stage, question_count=counts.get(stage, 0))
            for stage in range(6)
        ],
    )


def summarize_unit_progress(db: Session, user: User, course_id: UUID) -> UnitProgressSummary:
    """Aggregate this user's review progress per course unit, in unit order.

    Only resolved reviews are stored, so pending short answers never count as errors.
    Due counts use the same practice-availability rule as the course summary.
    """
    get_member_course(db, user, course_id)
    as_of = datetime.now(UTC)
    progress = UserQuestionProgress
    due = practice_eligible(user.id) & (progress.due_at <= as_of)
    rows = db.execute(
        select(
            CourseUnit.id,
            CourseUnit.title,
            CourseUnit.position,
            CourseUnit.is_archived,
            func.count(progress.id),
            func.coalesce(func.sum(progress.resolved_review_count), 0),
            func.coalesce(func.sum(progress.correct_review_count), 0),
            func.coalesce(func.sum(progress.incorrect_review_count), 0),
            func.coalesce(func.sum(case((due, 1), else_=0)), 0),
        )
        .select_from(CourseUnit)
        .outerjoin(QuestionUnit, QuestionUnit.unit_id == CourseUnit.id)
        .outerjoin(Question, Question.id == QuestionUnit.question_id)
        .outerjoin(progress, and_(progress.question_id == Question.id, progress.user_id == user.id))
        .where(CourseUnit.course_id == course_id)
        .group_by(CourseUnit.id)
        .order_by(CourseUnit.position, CourseUnit.id)
    ).all()
    return UnitProgressSummary(
        as_of=as_of,
        units=[
            UnitProgress(
                unit_id=row[0],
                title=row[1],
                position=row[2],
                is_archived=row[3],
                reviewed_questions=row[4],
                resolved_review_count=row[5],
                correct_review_count=row[6],
                incorrect_review_count=row[7],
                due_now=row[8],
            )
            for row in rows
        ],
    )


def review_forecast(
    db: Session, user: User, course_id: UUID, days: int, today: date | None = None
) -> ReviewForecast:
    """How many practice-eligible cards come due on each of the next `days` days.

    Days are Zagreb calendar days. Cards already overdue are counted on the first day.
    """
    # Imported here: course_summaries needs services that themselves import this module.
    from app.services.course_summaries import EXAM_TIMEZONE, zagreb_today

    get_member_course(db, user, course_id)
    first = today or zagreb_today()
    end = datetime.combine(first + timedelta(days=days), time.min, tzinfo=EXAM_TIMEZONE)
    due_times = db.scalars(
        select(UserQuestionProgress.due_at)
        .join(Question, Question.id == UserQuestionProgress.question_id)
        .where(
            UserQuestionProgress.user_id == user.id,
            Question.course_id == course_id,
            practice_eligible(user.id),
            UserQuestionProgress.due_at < end,
        )
    ).all()
    counts = [0] * days
    for due_at in due_times:
        offset = (due_at.astimezone(EXAM_TIMEZONE).date() - first).days
        counts[min(max(offset, 0), days - 1)] += 1
    return ReviewForecast(
        as_of=datetime.now(UTC),
        days=[
            ForecastDay(date=first + timedelta(days=index), count=count)
            for index, count in enumerate(counts)
        ],
    )
