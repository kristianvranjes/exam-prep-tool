from datetime import UTC, datetime
from typing import Literal, cast
from uuid import UUID

from fastapi import HTTPException
from pydantic import TypeAdapter
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import User
from app.models.course_unit import CourseUnit, QuestionUnit
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
    PracticeAvailability,
    PracticeFilters,
    QuestionUnitLabel,
    ResultQuestion,
    StartQuiz,
    SubmittedAttempt,
    TypeAvailability,
    UnitAvailability,
)
from app.services.courses import get_member_course
from app.services.exam_scopes import resolve_focus
from app.services.grading import grade
from app.services.progress import apply_reviews
from app.services.questions.service import owner_view
from app.services.quiz_selection import (
    count_by_type,
    count_by_unit,
    count_eligible,
    select_questions,
)

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


def summary(attempt: QuizAttempt, quiz: Quiz) -> AttemptSummary:
    return AttemptSummary(
        id=attempt.id,
        course_id=quiz.course_id,
        status=cast(Literal["ACTIVE", "SUBMITTED", "ABANDONED"], attempt.status),
        started_at=attempt.started_at,
        submitted_at=attempt.submitted_at,
        exam_scope_id=quiz.exam_scope_id,
        focus_unit_ids=[UUID(id_) for id_ in quiz.focus_unit_ids],
        focus_label=quiz.focus_label,
    )


def question_rows(db: Session, attempt: QuizAttempt) -> list[QuizQuestion]:
    return list(
        db.scalars(
            select(QuizQuestion)
            .where(QuizQuestion.quiz_id == attempt.quiz_id)
            .order_by(QuizQuestion.position)
        )
    )


def unit_labels(
    db: Session, course_id: UUID, question_ids: list[UUID]
) -> dict[UUID, list[QuestionUnitLabel]]:
    """Current active units per source question; deleted sources simply have none."""
    labels: dict[UUID, list[QuestionUnitLabel]] = {}
    if not question_ids:
        return labels
    rows = db.execute(
        select(QuestionUnit.question_id, CourseUnit.id, CourseUnit.title)
        .join(CourseUnit, CourseUnit.id == QuestionUnit.unit_id)
        .where(
            QuestionUnit.question_id.in_(question_ids),
            CourseUnit.course_id == course_id,
            CourseUnit.is_archived.is_(False),
        )
        .order_by(CourseUnit.position, CourseUnit.id)
    )
    for question_id, unit_id, title in rows:
        labels.setdefault(question_id, []).append(QuestionUnitLabel(id=unit_id, title=title))
    return labels


def representation(db: Session, attempt: QuizAttempt, course_id: UUID) -> AttemptResponse:
    answers = {
        a.quiz_question_id: a
        for a in db.scalars(select(Answer).where(Answer.attempt_id == attempt.id))
    }
    rows = question_rows(db, attempt)
    units = unit_labels(db, course_id, [row.source_question_id for row in rows])
    active: list[ActiveQuestion] = []
    results: list[ResultQuestion] = []
    for row in rows:
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
            units=units.get(row.source_question_id, []),
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
    quiz = db.get(Quiz, attempt.quiz_id)
    assert quiz is not None and quiz.course_id == course_id
    fields = summary(attempt, quiz).model_dump(exclude={"status"})
    if attempt.status == "SUBMITTED":
        return SubmittedAttempt(**fields, questions=results)
    if attempt.status == "ABANDONED":
        assert attempt.abandoned_at is not None
        return AbandonedAttempt(**fields, abandoned_at=attempt.abandoned_at, questions=active)
    return ActiveAttempt(**fields, questions=active)


def availability(
    db: Session, user: User, course_id: UUID, data: PracticeFilters
) -> PracticeAvailability:
    """Count what `start` would select now, without creating a session."""
    get_member_course(db, user, course_id)
    unit_ids, scope_id, _ = resolve_focus(db, course_id, data.unit_ids, data.exam_scope_id)
    course_total = count_eligible(db, user.id, course_id)
    if scope_id and not unit_ids:
        # Starting such a scope is refused, so nothing is available.
        by_type = dict.fromkeys(data.question_types, 0)
    else:
        by_type = count_by_type(db, user.id, course_id, data, unit_ids)
    by_unit = count_by_unit(db, user.id, course_id, data, unit_ids)
    return PracticeAvailability(
        course_total=course_total,
        total=sum(by_type.values()),
        by_type=[TypeAvailability(type=type_, count=count) for type_, count in by_type.items()],
        by_unit=[UnitAvailability(unit_id=id_, count=count) for id_, count in by_unit.items()],
    )


def start(db: Session, user: User, course_id: UUID, data: StartQuiz) -> AttemptResponse:
    get_member_course(db, user, course_id)
    try:
        # Serialize all starts for this user so adaptive exclusion sees committed starts.
        # Compatible with FK locks; shares submission's per-user serialization boundary.
        db.execute(select(User.id).where(User.id == user.id).with_for_update(key_share=True))
        selection_time = datetime.now(UTC)
        unit_ids, scope_id, label = resolve_focus(db, course_id, data.unit_ids, data.exam_scope_id)
        if scope_id and not unit_ids:
            raise HTTPException(409, "This exam scope has no units yet")
        questions = select_questions(db, user.id, course_id, data, selection_time, unit_ids)
        if len(questions) < data.count:
            filters = "type or unit filter" if unit_ids else "type filter"
            raise HTTPException(
                409,
                f"Only {len(questions)} eligible questions available; "
                f"requested {data.count}. Reduce the count or change the {filters}.",
            )
        quiz = Quiz(
            course_id=course_id,
            user_id=user.id,
            exam_scope_id=scope_id,
            focus_unit_ids=[str(id_) for id_ in unit_ids],
            focus_label=label,
        )
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
        summary(attempt, quiz)
        for attempt, quiz in db.execute(
            select(QuizAttempt, Quiz)
            .join(Quiz)
            .where(Quiz.course_id == course_id, Quiz.user_id == user.id)
            .order_by(QuizAttempt.started_at.desc(), QuizAttempt.id)
            .limit(limit)
            .offset(offset)
        ).tuples()
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
