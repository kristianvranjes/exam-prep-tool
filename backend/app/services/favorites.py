"""Private, course-scoped favorites. They never change grades, scheduling or attempt history."""

from typing import cast
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import User
from app.models.question import Question
from app.models.question_favorite import QuestionFavorite
from app.schemas.favorite import FavoriteQuestion, FavoriteState
from app.schemas.question import QuestionType
from app.services.courses import get_member_course
from app.services.moderation import course_moderator
from app.services.practice_eligibility import practice_eligible


def favorite(db: Session, user: User, course_id: UUID, question_id: UUID) -> FavoriteState:
    """Add a favorite; repeating it keeps the first one and its time."""
    get_member_course(db, user, course_id)
    try:
        # Share-lock the source so a moderation transition cannot slip in before the insert.
        source = (
            select(Question, practice_eligible(user.id))
            .where(Question.id == question_id, Question.course_id == course_id)
            .with_for_update(read=True, of=Question)
            .execution_options(populate_existing=True)
        )
        row = db.execute(source).tuples().first()
        if row is None:
            raise HTTPException(404, "Question not found")
        question, eligible = row
        if not eligible:
            # Only questions the caller may already see admit that they exist.
            if question.created_by_user_id == user.id or course_moderator(db, user, course_id):
                raise HTTPException(
                    409, "Only approved questions and your own drafts can be favorited"
                )
            raise HTTPException(404, "Question not found")
        db.execute(
            insert(QuestionFavorite)
            .values(user_id=user.id, question_id=question.id)
            .on_conflict_do_nothing(constraint="uq_question_favorite_user_question")
        )
        favorited_at = db.scalar(
            select(QuestionFavorite.created_at).where(
                QuestionFavorite.user_id == user.id, QuestionFavorite.question_id == question.id
            )
        )
        db.commit()
        return FavoriteState(question_id=question.id, favorite=True, favorited_at=favorited_at)
    except Exception:
        db.rollback()
        raise


def unfavorite(db: Session, user: User, course_id: UUID, question_id: UUID) -> FavoriteState:
    """Remove a favorite, also from a question that is no longer practice-eligible."""
    get_member_course(db, user, course_id)
    try:
        source = select(Question.id).where(
            Question.id == question_id, Question.course_id == course_id
        )
        if db.scalar(source) is None:
            raise HTTPException(404, "Question not found")
        db.execute(
            delete(QuestionFavorite).where(
                QuestionFavorite.user_id == user.id, QuestionFavorite.question_id == question_id
            )
        )
        db.commit()
        return FavoriteState(question_id=question_id, favorite=False, favorited_at=None)
    except Exception:
        db.rollback()
        raise


def list_favorites(
    db: Session, user: User, course_id: UUID, limit: int, offset: int
) -> list[FavoriteQuestion]:
    """The caller's favorites in this course, newest first."""
    get_member_course(db, user, course_id)
    rows = db.execute(
        select(QuestionFavorite.created_at, Question, practice_eligible(user.id))
        .join(Question, Question.id == QuestionFavorite.question_id)
        .where(QuestionFavorite.user_id == user.id, Question.course_id == course_id)
        .order_by(QuestionFavorite.created_at.desc(), Question.id)
        .limit(limit)
        .offset(offset)
    ).tuples()
    return [
        FavoriteQuestion(
            question_id=question.id,
            favorited_at=favorited_at,
            type=cast(QuestionType, question.type),
            stem=question.stem,
            difficulty=question.difficulty,
            available=eligible,
        )
        for favorited_at, question, eligible in rows
    ]


def favorited(db: Session, user_id: UUID, question_ids: list[UUID]) -> set[UUID]:
    """Which of these source questions the user has favorited.

    Only the user's own favorite rows decide it, never the question's current status, so
    archiving or editing a question cannot change a frozen attempt's representation.
    """
    if not question_ids:
        return set()
    return set(
        db.scalars(
            select(QuestionFavorite.question_id).where(
                QuestionFavorite.user_id == user_id,
                QuestionFavorite.question_id.in_(question_ids),
            )
        )
    )
