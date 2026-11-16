"""The caller's mistakes: the questions MISTAKES practice reviews, listed with their stems."""

from typing import cast
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models import User
from app.models.question import Question
from app.models.user_question_progress import UserQuestionProgress
from app.schemas.mistake import MistakeQuery, MistakeQuestion
from app.schemas.question import QuestionType
from app.services.courses import get_member_course
from app.services.exam_scopes import resolve_focus
from app.services.practice_eligibility import practice_eligible
from app.services.quiz_selection import in_focus, is_mistake
from app.services.quizzes import unit_labels


def list_mistakes(
    db: Session, user: User, course_id: UUID, query: MistakeQuery
) -> list[MistakeQuestion]:
    """Mistakes in this focus: practice-eligible ones first, in the order practice takes them.

    The MISTAKES predicate and focus are the ones practice uses. Questions that are no
    longer practice-eligible stay listed but unavailable, as favorites do.
    """
    get_member_course(db, user, course_id)
    unit_ids, scope_id, _ = resolve_focus(db, course_id, query.unit_ids, query.exam_scope_id)
    if scope_id and not unit_ids:
        # Practice refuses a scope without units, so nothing in it is a reviewable mistake.
        return []
    progress = UserQuestionProgress
    available = practice_eligible(user.id).label("available")
    rows = db.execute(
        select(Question, progress.last_reviewed_at, progress.incorrect_review_count, available)
        .join(progress, and_(progress.question_id == Question.id, progress.user_id == user.id))
        .where(*in_focus(course_id, query.question_types, unit_ids), is_mistake(user.id))
        # MISTAKES practice takes the oldest last review first; question ID breaks ties.
        .order_by(available.desc(), progress.last_reviewed_at, Question.id)
        .limit(query.limit)
        .offset(query.offset)
    ).all()
    units = unit_labels(db, course_id, [row[0].id for row in rows])
    return [
        MistakeQuestion(
            question_id=question.id,
            type=cast(QuestionType, question.type),
            stem=question.stem,
            difficulty=question.difficulty,
            units=units.get(question.id, []),
            last_reviewed_at=last_reviewed_at,
            incorrect_review_count=incorrect_review_count,
            available=eligible,
        )
        for question, last_reviewed_at, incorrect_review_count, eligible in rows
    ]
