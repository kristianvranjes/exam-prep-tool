"""Item analysis for course managers: which approved questions need a second look.

Loads graded answers and current-version options from the database; the statistics
themselves are pure (`item_statistics`). Responses are aggregates only and never
identify a student.
"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import cast
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models import User
from app.models.question import Question, QuestionVersion
from app.models.quiz import Answer, Quiz, QuizAttempt, QuizQuestion
from app.schemas.item_analysis import ItemAnalysis, ItemAnalysisList, OptionAnalysis
from app.schemas.question import QuestionType
from app.services.exam_papers import require_manager
from app.services.item_statistics import (
    ANALYSIS_VERSION,
    MIN_SAMPLE_SIZE,
    GradedAnswer,
    ItemStats,
    Option,
    analyse,
    priority,
)


def choice(payload: Mapping[str, object]) -> int | None:
    """The snapshot option position an answer chose; None for other answer types."""
    kind = payload.get("type")
    if kind == "MULTIPLE_CHOICE":
        position = payload.get("option_position")
        return position if type(position) is int else None
    if kind == "TRUE_FALSE":
        value = payload.get("value")
        # Students see True first, as in the practice editor.
        return None if type(value) is not bool else 0 if value else 1
    return None


def snapshot_options(snapshot: Mapping[str, object]) -> list[Option]:
    """Options keyed by snapshot position and text; True/False get two fixed options."""
    if snapshot.get("type") == "TRUE_FALSE":
        key = snapshot.get("correct_boolean")
        return [Option(0, "True", key is True), Option(1, "False", key is False)]
    if snapshot.get("type") != "MULTIPLE_CHOICE":
        return []
    rows = snapshot.get("options")
    return [
        Option(int(row["position"]), str(row["text"]), row.get("is_correct") is True)
        for row in (rows if isinstance(rows, list) else [])
        if isinstance(row, dict)
    ]


def load(
    db: Session, course_id: UUID
) -> tuple[dict[UUID, Question], list[GradedAnswer], dict[UUID, list[Option]], dict[UUID, int]]:
    """Approved questions, counted answers, current options and earlier-version samples.

    Counted answers are CORRECT or INCORRECT answers in submitted attempts, plus
    checked immediate-feedback answers in any attempt, to the question's current
    version. Pending short answers are never graded, so they never count.
    """
    current = (
        select(
            QuestionVersion.question_id, func.max(QuestionVersion.version_number).label("number")
        )
        .join(Question, Question.id == QuestionVersion.question_id)
        .where(Question.course_id == course_id, Question.status == "APPROVED")
        .group_by(QuestionVersion.question_id)
        .subquery()
    )
    questions = {
        question.id: question
        for question in db.scalars(
            select(Question).where(Question.course_id == course_id, Question.status == "APPROVED")
        )
    }
    options = {
        question_id: snapshot_options(snapshot)
        for question_id, snapshot in db.execute(
            select(QuestionVersion.question_id, QuestionVersion.snapshot).join(
                current,
                and_(
                    current.c.question_id == QuestionVersion.question_id,
                    current.c.number == QuestionVersion.version_number,
                ),
            )
        ).tuples()
    }
    rows = db.execute(
        select(
            Quiz.user_id,
            QuizQuestion.source_question_id,
            QuizQuestion.source_version == current.c.number,
            func.coalesce(Answer.checked_at, QuizAttempt.submitted_at),
            Answer.id,
            Answer.grading_status,
            Answer.payload,
        )
        .select_from(Answer)
        .join(QuizAttempt, QuizAttempt.id == Answer.attempt_id)
        .join(QuizQuestion, QuizQuestion.id == Answer.quiz_question_id)
        .join(Quiz, Quiz.id == QuizQuestion.quiz_id)
        .join(current, current.c.question_id == QuizQuestion.source_question_id)
        .where(
            Quiz.course_id == course_id,
            Answer.grading_status.in_(("CORRECT", "INCORRECT")),
            or_(QuizAttempt.status == "SUBMITTED", Answer.checked_at.is_not(None)),
        )
    ).tuples()
    answers: list[GradedAnswer] = []
    earlier: dict[UUID, set[UUID]] = defaultdict(set)
    for student, question_id, is_current, answered_at, answer_id, grade, payload in rows:
        if not is_current:
            earlier[question_id].add(student)
            continue
        answers.append(
            GradedAnswer(
                student=student,
                question=question_id,
                answered_at=answered_at,
                answer_id=answer_id,
                correct=grade == "CORRECT",
                choice=choice(payload),
            )
        )
    return questions, answers, options, {key: len(value) for key, value in earlier.items()}


def representation(question: Question, stats: ItemStats, earlier: int) -> ItemAnalysis:
    return ItemAnalysis(
        question_id=question.id,
        type=cast(QuestionType, question.type),
        stem=question.stem,
        sample_size=stats.sample_size,
        earlier_version_sample=earlier,
        enough_data=stats.enough_data,
        difficulty=stats.difficulty,
        upper_correct=stats.upper_correct,
        lower_correct=stats.lower_correct,
        discrimination=stats.discrimination,
        ranked_size=stats.ranked_size,
        group_size=stats.group_size,
        flags=list(stats.flags),
        options=[
            OptionAnalysis(
                position=option.position,
                text=option.text,
                is_key=option.is_key,
                count=option.count,
                share=option.share,
                upper_share=option.upper_share,
                lower_share=option.lower_share,
                flag=option.flag,
            )
            for option in stats.options
        ],
    )


def analyses(db: Session, course_id: UUID) -> list[ItemAnalysis]:
    """Every approved question with a graded answer, flagged and larger samples first."""
    questions, answers, options, earlier = load(db, course_id)
    # A question approved or archived between the queries is left for the next request.
    stats = {key: value for key, value in analyse(answers, options).items() if key in questions}
    for question_id in (earlier.keys() & questions.keys()) - stats.keys():
        stats[question_id] = ItemStats(question_id, 0)
    ordered: Sequence[ItemStats] = sorted(
        stats.values(),
        key=lambda item: (
            *priority(item),
            questions[item.question].normalized_stem,
            str(item.question),
        ),
    )
    return [
        representation(questions[item.question], item, earlier.get(item.question, 0))
        for item in ordered
    ]


def list_analysis(
    db: Session, user: User, course_id: UUID, limit: int, offset: int
) -> ItemAnalysisList:
    require_manager(db, user, course_id)
    items = analyses(db, course_id)
    return ItemAnalysisList(
        analysis_version=ANALYSIS_VERSION,
        min_sample_size=MIN_SAMPLE_SIZE,
        total=len(items),
        analysed=sum(1 for item in items if item.enough_data),
        flagged=sum(1 for item in items if item.flags),
        items=items[offset : offset + limit],
    )


def question_analysis(db: Session, user: User, course_id: UUID, question_id: UUID) -> ItemAnalysis:
    require_manager(db, user, course_id)
    question = db.get(Question, question_id)
    # Only approved questions are analysed; owners never see others' unpublished drafts.
    if question is None or question.course_id != course_id or question.status != "APPROVED":
        raise HTTPException(404, "Question not found")
    # Abilities come from the whole course, so the whole course is loaded.
    _, answers, options, earlier = load(db, course_id)
    stats = analyse(answers, options).get(question_id, ItemStats(question_id, 0))
    return representation(question, stats, earlier.get(question_id, 0))
