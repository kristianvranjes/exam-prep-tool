"""Deterministic selection; callers supply the clock and own the transaction."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, case, select
from sqlalchemy.orm import Session

from app.models.question import Question
from app.models.quiz import Quiz, QuizAttempt, QuizQuestion
from app.models.user_question_progress import UserQuestionProgress
from app.schemas.quiz import StartQuiz
from app.services.practice_eligibility import practice_eligible


def select_questions(
    db: Session, user_id: UUID, course_id: UUID, data: StartQuiz, selection_time: datetime
) -> list[Question]:
    query = select(Question).where(
        Question.course_id == course_id,
        practice_eligible(user_id),
        Question.type.in_(data.question_types),
    )
    if data.selection_mode == "ADAPTIVE":
        history = (
            select(QuizQuestion.id)
            .join(Quiz)
            .where(Quiz.user_id == user_id, QuizQuestion.source_question_id == Question.id)
            .correlate(Question)
        )
        active = (
            history.join(QuizAttempt, QuizAttempt.quiz_id == Quiz.id)
            .where(QuizAttempt.status == "ACTIVE")
            .exists()
        )
        progress = UserQuestionProgress
        priority = case(
            (progress.due_at <= selection_time, 0),
            (~history.exists(), 1),
            else_=2,
        )
        query = (
            query.outerjoin(
                progress, and_(progress.question_id == Question.id, progress.user_id == user_id)
            )
            .where(~active)
            .order_by(
                priority,
                # Unseen ordering is always creation/id, even for inconsistent imported state.
                case((priority != 1, progress.due_at), else_=None).asc().nulls_last(),
            )
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
