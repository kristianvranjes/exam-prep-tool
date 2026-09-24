from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import User
from app.models.question import Question
from app.models.user_question_progress import UserQuestionProgress
from app.schemas.progress import ProgressSummary, StageCount
from app.schemas.quiz import Grade
from app.services.courses import get_member_course
from app.services.scheduling import schedule


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
    for question_id in sources:
        result = resolved[question_id]
        row = existing.get(question_id)
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
        row.resolved_review_count += 1
        row.correct_review_count += int(result == "CORRECT")
        row.incorrect_review_count += int(result == "INCORRECT")
        row.last_result = result
        row.last_reviewed_at = submitted_at
        row.updated_at = submitted_at


def list_progress(
    db: Session, user: User, course_id: UUID, limit: int, offset: int
) -> list[UserQuestionProgress]:
    get_member_course(db, user, course_id)
    return list(
        db.scalars(
            select(UserQuestionProgress)
            .join(Question)
            .where(
                UserQuestionProgress.user_id == user.id,
                Question.course_id == course_id,
            )
            .order_by(UserQuestionProgress.due_at, UserQuestionProgress.question_id)
            .limit(limit)
            .offset(offset)
        )
    )


def summarize_progress(db: Session, user: User, course_id: UUID) -> ProgressSummary:
    get_member_course(db, user, course_id)
    as_of = datetime.now(UTC)
    progress = UserQuestionProgress
    scope = (progress.user_id == user.id, Question.course_id == course_id)
    totals = db.execute(
        select(
            func.count(progress.id),
            func.coalesce(func.sum(case((progress.due_at <= as_of, 1), else_=0)), 0),
            func.coalesce(func.sum(case((progress.due_at > as_of, 1), else_=0)), 0),
            func.coalesce(func.sum(progress.resolved_review_count), 0),
            func.coalesce(func.sum(progress.correct_review_count), 0),
            func.coalesce(func.sum(progress.incorrect_review_count), 0),
            func.max(progress.last_reviewed_at),
            func.min(progress.due_at),
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
