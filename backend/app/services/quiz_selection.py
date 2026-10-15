"""Deterministic selection; callers supply the clock and own the transaction."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Select, and_, case, func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.models.course_unit import QuestionUnit
from app.models.question import Question
from app.models.quiz import Quiz, QuizAttempt, QuizQuestion
from app.models.user_question_progress import UserQuestionProgress
from app.schemas.question import QuestionType
from app.schemas.quiz import PracticeFilters, StartQuiz
from app.services.practice_eligibility import practice_eligible


def _history(user_id: UUID) -> Select[tuple[UUID]]:
    """Snapshots of the correlated source question in this user's sessions."""
    return (
        select(QuizQuestion.id)
        .join(Quiz)
        .where(Quiz.user_id == user_id, QuizQuestion.source_question_id == Question.id)
        .correlate(Question)
    )


def selection_filters(
    user_id: UUID, course_id: UUID, data: PracticeFilters, unit_ids: list[UUID]
) -> list[ColumnElement[bool]]:
    """Which source questions a session with these filters may select.

    Session start and the availability summary both use this, so their counts agree.
    `unit_ids` is the resolved focus; empty means the whole course.
    """
    filters = [
        Question.course_id == course_id,
        practice_eligible(user_id),
        Question.type.in_(data.question_types),
    ]
    if unit_ids:
        # A question linked to any focused unit matches; unlinked questions do not.
        filters.append(
            Question.id.in_(
                select(QuestionUnit.question_id).where(QuestionUnit.unit_id.in_(unit_ids))
            )
        )
    if data.selection_mode == "ADAPTIVE":
        active = (
            _history(user_id)
            .join(QuizAttempt, QuizAttempt.quiz_id == Quiz.id)
            .where(QuizAttempt.status == "ACTIVE")
            .exists()
        )
        filters.append(~active)
    return filters


def select_questions(
    db: Session,
    user_id: UUID,
    course_id: UUID,
    data: StartQuiz,
    selection_time: datetime,
    unit_ids: list[UUID] | None = None,
) -> list[Question]:
    query = select(Question).where(*selection_filters(user_id, course_id, data, unit_ids or []))
    if data.selection_mode == "ADAPTIVE":
        progress = UserQuestionProgress
        priority = case(
            (progress.due_at <= selection_time, 0),
            (~_history(user_id).exists(), 1),
            else_=2,
        )
        query = query.outerjoin(
            progress, and_(progress.question_id == Question.id, progress.user_id == user_id)
        ).order_by(
            priority,
            # Unseen ordering is always creation/id, even for inconsistent imported state.
            case((priority != 1, progress.due_at), else_=None).asc().nulls_last(),
        )
    # Shared source locks prevent edits/archive/delete until snapshots are committed.
    # Readers with different adaptive rankings cannot deadlock on one another.
    return list(
        db.scalars(
            query.order_by(Question.created_at, Question.id)
            .limit(data.count)
            .with_for_update(read=True, of=Question)
        )
    )


def count_by_type(
    db: Session, user_id: UUID, course_id: UUID, data: PracticeFilters, unit_ids: list[UUID]
) -> dict[QuestionType, int]:
    filters = selection_filters(user_id, course_id, data, unit_ids)
    counts: dict[QuestionType, int] = {type_: 0 for type_ in data.question_types}
    for type_, count in db.execute(
        select(Question.type, func.count(Question.id)).where(*filters).group_by(Question.type)
    ):
        counts[type_] = count
    return counts


def count_by_unit(
    db: Session, user_id: UUID, course_id: UUID, data: PracticeFilters, unit_ids: list[UUID]
) -> dict[UUID, int]:
    if not unit_ids:
        return {}
    filters = selection_filters(user_id, course_id, data, unit_ids)
    counts = dict.fromkeys(unit_ids, 0)
    for unit_id, count in db.execute(
        select(QuestionUnit.unit_id, func.count(Question.id))
        .join(Question, Question.id == QuestionUnit.question_id)
        .where(*filters, QuestionUnit.unit_id.in_(unit_ids))
        .group_by(QuestionUnit.unit_id)
    ):
        counts[unit_id] = count
    return counts


def count_eligible(db: Session, user_id: UUID, course_id: UUID) -> int:
    return (
        db.scalar(
            select(func.count(Question.id)).where(
                Question.course_id == course_id, practice_eligible(user_id)
            )
        )
        or 0
    )
