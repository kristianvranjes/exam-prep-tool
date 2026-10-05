from datetime import UTC, datetime
from typing import Literal, cast
from uuid import UUID

from fastapi import HTTPException
from pydantic import TypeAdapter
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import User
from app.models.question import QuestionVersion
from app.models.quiz import Answer, Quiz, QuizAttempt, QuizQuestion
from app.schemas.question import OwnerQuestion, PublicOption
from app.schemas.quiz import (
    AbandonedAttempt,
    ActiveAttempt,
    ActiveQuestion,
    AnswerPayload,
    AttemptResponse,
    AttemptSummary,
    Grade,
    MCQAnswer,
    ResultQuestion,
    StartQuiz,
    SubmittedAttempt,
)
from app.services.courses import get_member_course
from app.services.grading import grade
from app.services.progress import apply_reviews
from app.services.questions.service import owner_view
from app.services.quiz_selection import select_questions

answer_adapter: TypeAdapter[AnswerPayload] = TypeAdapter(AnswerPayload)


def load_attempt(db: Session, user: User, course_id: UUID, attempt_id: UUID) -> QuizAttempt:
    get_member_course(db, user, course_id)
    # Reads also lock: an ACTIVE status must never be paired with post-submission data.
    attempt = db.scalar(
        select(QuizAttempt)
        .join(Quiz)
        .where(QuizAttempt.id == attempt_id, Quiz.course_id == course_id, Quiz.user_id == user.id)
        .with_for_update(of=QuizAttempt)
        .execution_options(populate_existing=True)
    )
    if attempt is None:
        raise HTTPException(404, "Attempt not found")
    return attempt


def summary(attempt: QuizAttempt, course_id: UUID) -> AttemptSummary:
    return AttemptSummary(
        id=attempt.id,
        course_id=course_id,
        status=cast(Literal["ACTIVE", "SUBMITTED", "ABANDONED"], attempt.status),
        started_at=attempt.started_at,
        submitted_at=attempt.submitted_at,
    )


def question_rows(db: Session, attempt: QuizAttempt) -> list[QuizQuestion]:
    return list(
        db.scalars(
            select(QuizQuestion)
            .where(QuizQuestion.quiz_id == attempt.quiz_id)
            .order_by(QuizQuestion.position)
        )
    )


def representation(db: Session, attempt: QuizAttempt, course_id: UUID) -> AttemptResponse:
    answers = {
        a.quiz_question_id: a
        for a in db.scalars(select(Answer).where(Answer.attempt_id == attempt.id))
    }
    active: list[ActiveQuestion] = []
    results: list[ResultQuestion] = []
    for row in question_rows(db, attempt):
        content = OwnerQuestion.model_validate(row.snapshot)
        answer = answers.get(row.id)
        public = ActiveQuestion(
            id=row.id,
            position=row.position,
            type=content.type,
            stem=content.stem,
            difficulty=content.difficulty,
            options=[PublicOption(position=o.position, text=o.text) for o in content.options],
            answer=answer_adapter.validate_python(answer.payload) if answer else None,
        )
        active.append(public)
        if attempt.status == "SUBMITTED":
            results.append(
                ResultQuestion(
                    **public.model_dump(exclude={"options"}),
                    options=content.options,
                    explanation=content.explanation,
                    correct_boolean=content.correct_boolean,
                    reference_answer=content.reference_answer,
                    grading_status=cast(Grade, answer.grading_status) if answer else "PENDING",
                )
            )
    fields = summary(attempt, course_id).model_dump(exclude={"status"})
    if attempt.status == "SUBMITTED":
        return SubmittedAttempt(**fields, questions=results)
    if attempt.status == "ABANDONED":
        assert attempt.abandoned_at is not None
        return AbandonedAttempt(**fields, abandoned_at=attempt.abandoned_at, questions=active)
    return ActiveAttempt(**fields, questions=active)


def start(db: Session, user: User, course_id: UUID, data: StartQuiz) -> AttemptResponse:
    get_member_course(db, user, course_id)
    try:
        # Serialize all starts for this user so adaptive exclusion sees committed starts.
        # Compatible with FK locks; shares submission's per-user serialization boundary.
        db.execute(select(User.id).where(User.id == user.id).with_for_update(key_share=True))
        selection_time = datetime.now(UTC)
        questions = select_questions(db, user.id, course_id, data, selection_time)
        if len(questions) < data.count:
            raise HTTPException(
                409,
                f"Only {len(questions)} eligible questions available; "
                f"requested {data.count}. Reduce the count or change the type filter.",
            )
        quiz = Quiz(course_id=course_id, user_id=user.id)
        db.add(quiz)
        db.flush()
        for position, question in enumerate(questions):
            version = db.scalar(
                select(func.max(QuestionVersion.version_number)).where(
                    QuestionVersion.question_id == question.id
                )
            )
            if version is None:
                raise HTTPException(409, "Approved question has no version history")
            db.add(
                QuizQuestion(
                    quiz_id=quiz.id,
                    position=position,
                    source_question_id=question.id,
                    source_version=version,
                    snapshot=owner_view(db, question).model_dump(mode="json"),
                )
            )
        attempt = QuizAttempt(quiz_id=quiz.id)
        db.add(attempt)
        db.flush()
        result = representation(db, attempt, course_id)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def list_attempts(
    db: Session, user: User, course_id: UUID, limit: int, offset: int
) -> list[AttemptSummary]:
    get_member_course(db, user, course_id)
    return [
        summary(a, course_id)
        for a in db.scalars(
            select(QuizAttempt)
            .join(Quiz)
            .where(Quiz.course_id == course_id, Quiz.user_id == user.id)
            .order_by(QuizAttempt.started_at.desc(), QuizAttempt.id)
            .limit(limit)
            .offset(offset)
        )
    ]


def require_active(attempt: QuizAttempt) -> None:
    if attempt.status == "ABANDONED":
        raise HTTPException(409, "Quiz abandoned; answers are frozen")
    if attempt.status != "ACTIVE":
        raise HTTPException(409, "Quiz already submitted; answers are frozen")


def save_answer(
    db: Session,
    user: User,
    course_id: UUID,
    attempt_id: UUID,
    question_id: UUID,
    data: AnswerPayload,
) -> AttemptResponse:
    attempt = load_attempt(db, user, course_id, attempt_id)
    require_active(attempt)
    question = db.scalar(
        select(QuizQuestion).where(
            QuizQuestion.id == question_id, QuizQuestion.quiz_id == attempt.quiz_id
        )
    )
    if question is None:
        raise HTTPException(404, "Attempt question not found")
    content = OwnerQuestion.model_validate(question.snapshot)
    if data.type != content.type or (
        isinstance(data, MCQAnswer)
        and data.option_position not in {o.position for o in content.options}
    ):
        raise HTTPException(422, "Answer must match the question type and available options")
    try:
        answer = db.scalar(
            select(Answer).where(
                Answer.attempt_id == attempt.id, Answer.quiz_question_id == question.id
            )
        )
        if answer is None:
            answer = Answer(attempt_id=attempt.id, quiz_question_id=question.id)
            db.add(answer)
        answer.payload = data.model_dump()
        db.flush()
        result = representation(db, attempt, course_id)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def submit(db: Session, user: User, course_id: UUID, attempt_id: UUID) -> AttemptResponse:
    attempt = load_attempt(db, user, course_id, attempt_id)
    if attempt.status == "SUBMITTED":
        return representation(db, attempt, course_id)
    require_active(attempt)
    try:
        answers = {
            a.quiz_question_id: a
            for a in db.scalars(select(Answer).where(Answer.attempt_id == attempt.id))
        }
        questions = question_rows(db, attempt)
        if len(answers) != len(questions):
            raise HTTPException(409, "Save an answer to every question before submitting")
        # Serialize overlapping attempts, including first inserts for the same question.
        # NO KEY UPDATE is compatible with FK key-share locks held by other attempts.
        db.execute(select(User.id).where(User.id == user.id).with_for_update(key_share=True))
        submitted_at = datetime.now(UTC)
        review_results: dict[UUID, Grade] = {}
        for question in questions:
            answer = answers[question.id]
            grading_result = grade(
                OwnerQuestion.model_validate(question.snapshot),
                answer_adapter.validate_python(answer.payload),
            )
            answer.grading_status = grading_result.status
            answer.grading_method = grading_result.method
            answer.grading_version = grading_result.version
            review_results[question.source_question_id] = grading_result.status
        attempt.status = "SUBMITTED"
        attempt.submitted_at = submitted_at
        apply_reviews(db, user.id, review_results, submitted_at)
        db.flush()
        result = representation(db, attempt, course_id)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def abandon(db: Session, user: User, course_id: UUID, attempt_id: UUID) -> AttemptResponse:
    attempt = load_attempt(db, user, course_id, attempt_id)
    if attempt.status == "ABANDONED":
        return representation(db, attempt, course_id)
    require_active(attempt)
    try:
        # Share the start/submission boundary so adaptive starts see committed closure.
        db.execute(select(User.id).where(User.id == user.id).with_for_update(key_share=True))
        attempt.status = "ABANDONED"
        attempt.abandoned_at = datetime.now(UTC)
        db.flush()
        result = representation(db, attempt, course_id)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
