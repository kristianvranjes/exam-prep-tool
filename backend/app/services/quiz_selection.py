"""Deterministic selection; callers supply the clock and own the transaction."""

from collections.abc import Hashable, Sequence
from datetime import datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import Select, and_, case, func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.models.course_unit import QuestionUnit
from app.models.question import Question
from app.models.question_favorite import QuestionFavorite
from app.models.quiz import Quiz, QuizAttempt, QuizQuestion
from app.models.user_question_progress import UserQuestionProgress
from app.schemas.question import QuestionType
from app.schemas.quiz import PracticeFilters, SelectionMode, StartQuiz
from app.services.practice_eligibility import practice_eligible


# Select generics differ between SQLAlchemy 2.0 and 2.1, so keep the row type open.
def _history(user_id: UUID) -> Select[Any]:
    """Snapshots of the correlated source question in this user's sessions."""
    return (
        select(QuizQuestion.id)
        .join(Quiz)
        .where(Quiz.user_id == user_id, QuizQuestion.source_question_id == Question.id)
        .correlate(Question)
    )


def _progress(user_id: UUID) -> Select[Any]:
    """This user's review progress for the correlated source question."""
    progress = UserQuestionProgress
    return (
        select(progress.id)
        .where(progress.user_id == user_id, progress.question_id == Question.id)
        .correlate(Question)
    )


def _favorite(user_id: UUID) -> Select[Any]:
    """This user's favorite on the correlated source question."""
    favorite = QuestionFavorite
    return (
        select(favorite.id)
        .where(favorite.user_id == user_id, favorite.question_id == Question.id)
        .correlate(Question)
    )


def in_focus(
    course_id: UUID, question_types: Sequence[str], unit_ids: list[UUID]
) -> list[ColumnElement[bool]]:
    """Course, type and unit focus shared by practice and the lists that lead into it.

    `unit_ids` is the resolved focus; empty means the whole course.
    """
    filters = [Question.course_id == course_id, Question.type.in_(question_types)]
    if unit_ids:
        # A question linked to any focused unit matches; unlinked questions do not.
        filters.append(
            Question.id.in_(
                select(QuestionUnit.question_id).where(QuestionUnit.unit_id.in_(unit_ids))
            )
        )
    return filters


def is_mistake(user_id: UUID) -> ColumnElement[bool]:
    """Whether this user's latest resolved review of the source question was incorrect.

    Only resolved reviews are stored, so a pending short answer is never a mistake
    and a later correct answer removes the question.
    """
    return _progress(user_id).where(UserQuestionProgress.last_result == "INCORRECT").exists()


def selection_filters(
    user_id: UUID, course_id: UUID, data: PracticeFilters, unit_ids: list[UUID], as_of: datetime
) -> list[ColumnElement[bool]]:
    """Which source questions a session with these filters may select.

    Session start and the availability summary both use this, so their counts agree.
    `unit_ids` is the resolved focus; empty means the whole course. `as_of` decides
    what is due.
    """
    filters = [*in_focus(course_id, data.question_types, unit_ids), practice_eligible(user_id)]
    progress = UserQuestionProgress
    if data.selection_mode == "MISTAKES":
        filters.append(is_mistake(user_id))
    elif data.selection_mode == "DUE":
        filters.append(_progress(user_id).where(progress.due_at <= as_of).exists())
    elif data.selection_mode == "FAVORITES":
        # Ineligible favorites stay saved but are never selected.
        filters.append(_favorite(user_id).exists())
    if data.selection_mode != "STANDARD":
        # Review and mock sessions skip questions already waiting in an unfinished session.
        active = (
            _history(user_id)
            .join(QuizAttempt, QuizAttempt.quiz_id == Quiz.id)
            .where(QuizAttempt.status == "ACTIVE")
            .exists()
        )
        filters.append(~active)
    return filters


def _ranked(
    query: Select[Any], user_id: UUID, mode: SelectionMode, selection_time: datetime
) -> Select[Any]:
    """Order a selection query by the mode's ranking; question ID always breaks ties."""
    if mode == "STANDARD":
        return query.order_by(Question.created_at, Question.id)
    if mode == "FAVORITES":
        favorite = QuestionFavorite
        return query.join(
            favorite, and_(favorite.question_id == Question.id, favorite.user_id == user_id)
        ).order_by(favorite.created_at, Question.id)
    progress = UserQuestionProgress
    query = query.outerjoin(
        progress, and_(progress.question_id == Question.id, progress.user_id == user_id)
    )
    if mode == "MISTAKES":
        return query.order_by(progress.last_reviewed_at, Question.id)
    if mode == "DUE":
        return query.order_by(progress.due_at, Question.id)
    # ADAPTIVE, and MOCK within each unit: due, then unseen, then the rest.
    priority = case(
        (progress.due_at <= selection_time, 0),
        (~_history(user_id).exists(), 1),
        else_=2,
    )
    return query.order_by(
        priority,
        # Unseen ordering is always creation/id, even for inconsistent imported state.
        case((priority != 1, progress.due_at), else_=None).asc().nulls_last(),
        Question.created_at,
        Question.id,
    )


def spread[T: Hashable](ranked_by_unit: Sequence[Sequence[T]], count: int) -> list[T]:
    """Pick up to `count` items round-robin across units, keeping the units' order.

    Each round takes every unit's best-ranked item not picked yet, so a question in
    several units counts once and an exhausted unit drops out while the others keep
    filling. The result lists items by the unit that picked them, then by round.
    """
    picked: list[list[T]] = [[] for _ in ranked_by_unit]
    seen: set[T] = set()
    queues = [(index, iter(items)) for index, items in enumerate(ranked_by_unit)]
    while queues and len(seen) < count:
        remaining = []
        for index, queue in queues:
            if len(seen) == count:
                break
            item = next((item for item in queue if item not in seen), None)
            if item is None:
                continue
            seen.add(item)
            picked[index].append(item)
            remaining.append((index, queue))
        queues = remaining
    return [item for items in picked for item in items]


def select_questions(
    db: Session,
    user_id: UUID,
    course_id: UUID,
    data: StartQuiz,
    selection_time: datetime,
    unit_ids: list[UUID] | None = None,
) -> list[Question]:
    unit_ids = unit_ids or []
    query = select(Question).where(
        *selection_filters(user_id, course_id, data, unit_ids, selection_time)
    )
    mode = data.selection_mode
    # Shared source locks prevent edits/archive/delete until snapshots are committed.
    # Readers with different rankings cannot deadlock on one another.
    if mode == "MOCK":
        return _mock(db, query, user_id, unit_ids, data.count, selection_time)
    if data.include_mistakes:
        return _mistakes_first(db, user_id, course_id, data, unit_ids, selection_time)
    return list(
        db.scalars(
            _ranked(query, user_id, mode, selection_time)
            .limit(data.count)
            .with_for_update(read=True, of=Question)
        )
    )


def _mistakes_first(
    db: Session,
    user_id: UUID,
    course_id: UUID,
    data: StartQuiz,
    unit_ids: list[UUID],
    selection_time: datetime,
) -> list[Question]:
    """The course's mistakes first (oldest review first), then ADAPTIVE within the focus.

    Both parts keep the session's type filter and skip questions waiting in an unfinished
    session; a mistake inside the focus is taken once, as a mistake.
    """
    mistakes = data.model_copy(update={"selection_mode": "MISTAKES", "include_mistakes": False})
    first = list(
        db.scalars(
            _ranked(
                select(Question).where(
                    *selection_filters(user_id, course_id, mistakes, [], selection_time)
                ),
                user_id,
                "MISTAKES",
                selection_time,
            )
            .limit(data.count)
            .with_for_update(read=True, of=Question)
        )
    )
    remaining = data.count - len(first)
    if remaining == 0:
        return first
    filters = selection_filters(user_id, course_id, data, unit_ids, selection_time)
    if first:
        filters.append(Question.id.not_in([question.id for question in first]))
    rest = db.scalars(
        _ranked(select(Question).where(*filters), user_id, "ADAPTIVE", selection_time)
        .limit(remaining)
        .with_for_update(read=True, of=Question)
    )
    return [*first, *rest]


def _mock(
    db: Session,
    query: Select[Any],
    user_id: UUID,
    unit_ids: list[UUID],
    count: int,
    selection_time: datetime,
) -> list[Question]:
    """Rank each scope unit's candidates adaptively, then spread `count` across units."""
    rows = db.execute(
        _ranked(
            query.add_columns(QuestionUnit.unit_id).join(
                QuestionUnit,
                and_(QuestionUnit.question_id == Question.id, QuestionUnit.unit_id.in_(unit_ids)),
            ),
            user_id,
            "MOCK",
            selection_time,
        ).with_for_update(read=True, of=Question)
    ).tuples()
    ranked: dict[UUID, list[UUID]] = {unit_id: [] for unit_id in unit_ids}
    questions: dict[UUID, Question] = {}
    for question, unit_id in rows:
        ranked[unit_id].append(question.id)
        questions[question.id] = question
    return [questions[id_] for id_ in spread([ranked[unit_id] for unit_id in unit_ids], count)]


def count_by_type(
    db: Session,
    user_id: UUID,
    course_id: UUID,
    data: PracticeFilters,
    unit_ids: list[UUID],
    as_of: datetime,
) -> dict[QuestionType, int]:
    filters = selection_filters(user_id, course_id, data, unit_ids, as_of)
    counts: dict[QuestionType, int] = {type_: 0 for type_ in data.question_types}
    for type_, count in db.execute(
        select(Question.type, func.count(Question.id)).where(*filters).group_by(Question.type)
    ):
        counts[cast(QuestionType, type_)] = count
    return counts


def count_by_unit(
    db: Session,
    user_id: UUID,
    course_id: UUID,
    data: PracticeFilters,
    unit_ids: list[UUID],
    as_of: datetime,
) -> dict[UUID, int]:
    if not unit_ids:
        return {}
    filters = selection_filters(user_id, course_id, data, unit_ids, as_of)
    counts = dict.fromkeys(unit_ids, 0)
    for unit_id, count in db.execute(
        select(QuestionUnit.unit_id, func.count(Question.id))
        .join(Question, Question.id == QuestionUnit.question_id)
        .where(*filters, QuestionUnit.unit_id.in_(unit_ids))
        .group_by(QuestionUnit.unit_id)
    ):
        counts[unit_id] = count
    return counts


def count_total(
    db: Session,
    user_id: UUID,
    course_id: UUID,
    data: PracticeFilters,
    unit_ids: list[UUID],
    as_of: datetime,
) -> int:
    filters = selection_filters(user_id, course_id, data, unit_ids, as_of)
    return db.scalar(select(func.count(Question.id)).where(*filters)) or 0


def count_eligible(db: Session, user_id: UUID, course_id: UUID) -> int:
    return (
        db.scalar(
            select(func.count(Question.id)).where(
                Question.course_id == course_id, practice_eligible(user_id)
            )
        )
        or 0
    )
