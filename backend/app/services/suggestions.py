from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Course, User
from app.models.question import Question, QuestionVersion
from app.models.question_edit_suggestion import QuestionEditSuggestion
from app.schemas.question import (
    MCQ,
    MultipleSelect,
    OwnerQuestion,
    QuestionContent,
    content_adapter,
)
from app.schemas.question_edit_suggestion import (
    ModeratorSuggestion,
    SuggestionChanges,
    SuggestionCreate,
    SuggestionReceipt,
    SuggestionStatus,
)
from app.services.courses import get_member_course
from app.services.moderation import require_moderator
from app.services.questions import service as questions


def latest_version(db: Session, question_id: UUID) -> int:
    number = db.scalar(
        select(func.max(QuestionVersion.version_number)).where(
            QuestionVersion.question_id == question_id
        )
    )
    if number is None:
        raise HTTPException(409, "Question history is unavailable")
    return number


def proposed_content(
    db: Session, question: Question, changes: SuggestionChanges
) -> QuestionContent:
    supplied = changes.model_dump(exclude_unset=True)
    applicable = {"stem", "explanation", "difficulty"}
    applicable |= {
        "MULTIPLE_CHOICE": {"options", "correct_option_position"},
        "TRUE_FALSE": {"correct_answer"},
        "SHORT_ANSWER": {"reference_answer"},
        "MULTIPLE_SELECT": {"options", "correct_option_positions"},
        "NUMERIC": {"correct_value", "absolute_tolerance", "relative_tolerance", "unit"},
    }[question.type]
    if supplied.keys() - applicable:
        raise HTTPException(422, "Proposed fields do not apply to this question type")
    candidate = questions.current_content(db, question)
    if question.type in ("MULTIPLE_CHOICE", "MULTIPLE_SELECT"):
        current_options = questions.options(db, question)
        by_position = {option.position: option for option in current_options}
        text_changes = {option.position: option.text for option in changes.options or []}
        key_positions = (
            {changes.correct_option_position}
            if changes.correct_option_position is not None
            else set(changes.correct_option_positions)
            if changes.correct_option_positions is not None
            else None
        )
        if text_changes.keys() - by_position.keys() or (
            key_positions is not None and key_positions - by_position.keys()
        ):
            raise HTTPException(422, "Propose changes to existing option positions only")
        candidate["options"] = [
            {
                "text": text_changes.get(option.position, option.text),
                "is_correct": (
                    option.position in key_positions
                    if key_positions is not None
                    else option.is_correct
                ),
            }
            for option in current_options
        ]
    candidate.update(
        {
            key: value
            for key, value in supplied.items()
            if key not in {"options", "correct_option_position", "correct_option_positions"}
        }
    )
    try:
        # Never compare for equality with the hidden key. Valid identical proposals
        # receive the same receipt as any other valid proposal.
        return content_adapter.validate_python(candidate)
    except ValidationError:
        raise HTTPException(422, "Invalid proposed question content") from None


def create_suggestion(
    db: Session, user: User, question_id: UUID, data: SuggestionCreate
) -> SuggestionReceipt:
    try:
        question, _ = questions.load_question(db, user, question_id, mutate=True)
        get_member_course(db, user, question.course_id)
        if question.status != "APPROVED":
            raise HTTPException(409, "Only approved questions accept edit suggestions")
        suggestion = QuestionEditSuggestion(
            question_id=question.id,
            suggested_by_user_id=user.id,
            base_version_number=latest_version(db, question.id),
            proposed_content=proposed_content(db, question, data.changes).model_dump(mode="json"),
            note=data.note,
        )
        db.add(suggestion)
        db.flush()
        result = SuggestionReceipt.model_validate(suggestion, from_attributes=True)
        db.commit()
        return result
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if constraint == "uq_question_suggestion_open":
            raise HTTPException(
                409, "You already have an open suggestion for this question"
            ) from None
        raise HTTPException(503, "Could not submit suggestion") from None
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not submit suggestion") from None


def moderator_view(
    db: Session, suggestion: QuestionEditSuggestion, question: Question
) -> ModeratorSuggestion:
    snapshot = db.scalar(
        select(QuestionVersion.snapshot).where(
            QuestionVersion.question_id == question.id,
            QuestionVersion.version_number == suggestion.base_version_number,
        )
    )
    return ModeratorSuggestion.model_validate(
        {
            **SuggestionReceipt.model_validate(suggestion, from_attributes=True).model_dump(),
            "suggested_by_user_id": suggestion.suggested_by_user_id,
            "note": suggestion.note,
            "resolution": suggestion.resolution,
            "resolution_reason": suggestion.resolution_reason,
            "resolved_by_user_id": suggestion.resolved_by_user_id,
            "resolved_at": suggestion.resolved_at,
            "applied_version_number": suggestion.applied_version_number,
            "base_snapshot": OwnerQuestion.model_validate(snapshot),
            "proposed_content": suggestion.proposed_content,
            "question": questions.owner_view(db, question),
        }
    )


def suggestion_queue(
    db: Session,
    user: User,
    faculty_id: UUID,
    course_id: UUID | None,
    status: SuggestionStatus,
    limit: int,
    offset: int,
) -> list[ModeratorSuggestion]:
    require_moderator(db, user, faculty_id)
    if (
        course_id is not None
        and db.scalar(
            select(Course.id).where(Course.id == course_id, Course.faculty_id == faculty_id)
        )
        is None
    ):
        raise HTTPException(404, "Course not found")
    query = (
        select(QuestionEditSuggestion, Question)
        .join(Question, Question.id == QuestionEditSuggestion.question_id)
        .join(Course, Course.id == Question.course_id)
        .where(Course.faculty_id == faculty_id, QuestionEditSuggestion.status == status)
    )
    if course_id is not None:
        query = query.where(Question.course_id == course_id)
    order = (
        (QuestionEditSuggestion.created_at, QuestionEditSuggestion.id)
        if status == "OPEN"
        else (QuestionEditSuggestion.resolved_at.desc(), QuestionEditSuggestion.id)
    )
    rows = db.execute(
        query.order_by(*order).limit(limit).offset(offset).with_for_update(read=True, of=Question)
    )
    return [moderator_view(db, suggestion, question) for suggestion, question in rows]


def lock_suggestion(
    db: Session, user: User, suggestion_id: UUID
) -> tuple[QuestionEditSuggestion, Question]:
    # Every decision locks the question first, then the suggestion. Creation,
    # archive and report decisions share this order; siblings cannot deadlock.
    question_id = db.scalar(
        select(QuestionEditSuggestion.question_id).where(QuestionEditSuggestion.id == suggestion_id)
    )
    if question_id is None:
        raise HTTPException(404, "Suggestion not found")
    question = db.scalar(
        select(Question)
        .where(Question.id == question_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if question is None:
        raise HTTPException(404, "Suggestion not found")
    faculty_id = db.scalar(select(Course.faculty_id).where(Course.id == question.course_id))
    if faculty_id is None:
        raise HTTPException(404, "Suggestion not found")
    require_moderator(db, user, faculty_id)
    suggestion = db.scalar(
        select(QuestionEditSuggestion)
        .where(QuestionEditSuggestion.id == suggestion_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if suggestion is None:
        raise HTTPException(404, "Suggestion not found")
    if suggestion.suggested_by_user_id == user.id:
        raise HTTPException(403, "Another faculty moderator must review this suggestion")
    if suggestion.status != "OPEN":
        raise HTTPException(409, "Suggestion is already resolved")
    return suggestion, question


def decide_suggestion(
    db: Session, user: User, suggestion_id: UUID, *, approve: bool, reason: str | None = None
) -> ModeratorSuggestion:
    try:
        suggestion, question = lock_suggestion(db, user, suggestion_id)
        decision_time = datetime.now(UTC)
        if approve:
            if (
                question.status != "APPROVED"
                or latest_version(db, question.id) != suggestion.base_version_number
            ):
                raise HTTPException(
                    409, "Question changed since this suggestion; submit a new proposal"
                )
            try:
                content = content_adapter.validate_python(suggestion.proposed_content)
            except ValidationError:
                raise HTTPException(409, "Proposed content requires rework") from None
            if content.type != question.type or (
                isinstance(content, MCQ | MultipleSelect)
                and len(content.options) != len(questions.options(db, question))
            ):
                raise HTTPException(
                    409, "Proposed content no longer matches the question structure"
                )
            questions.validate_provenance(
                db, question, questions.owner_view(db, question).concept_ids
            )
            questions.save_content(db, question, content)
            question.reviewed_by_user_id = user.id
            question.reviewed_at = decision_time
            question.rejection_reason = None
            questions.add_version(db, question, user, "EDITED")
            suggestion.applied_version_number = suggestion.base_version_number + 1
            db.execute(
                update(QuestionEditSuggestion)
                .where(
                    QuestionEditSuggestion.question_id == question.id,
                    QuestionEditSuggestion.id != suggestion.id,
                    QuestionEditSuggestion.status == "OPEN",
                )
                .values(
                    status="RESOLVED",
                    resolution="SUPERSEDED",
                    resolved_by_user_id=user.id,
                    resolved_at=decision_time,
                )
            )
        elif not reason or not reason.strip() or len(reason.strip()) > 1000:
            raise HTTPException(422, "A rejection reason is required")
        suggestion.status = "RESOLVED"
        suggestion.resolution = "APPLIED" if approve else "REJECTED"
        suggestion.resolution_reason = None if approve else reason.strip() if reason else None
        suggestion.resolved_by_user_id = user.id
        suggestion.resolved_at = decision_time
        db.flush()
        result = moderator_view(db, suggestion, question)
        db.commit()
        return result
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if constraint in {"uq_question_approved_stem", "uq_question_creator_active_stem"}:
            raise HTTPException(
                409, "Question conflicts with existing content; suggestion not applied"
            ) from None
        raise HTTPException(503, "Could not resolve suggestion") from None
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not resolve suggestion") from None
