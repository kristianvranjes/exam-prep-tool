from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User
from app.models.concept import Concept
from app.models.material import Material
from app.models.material_chunk import MaterialChunk
from app.models.question import (
    Question,
    QuestionChunk,
    QuestionConcept,
    QuestionOption,
    QuestionVersion,
)
from app.models.question_edit_suggestion import QuestionEditSuggestion
from app.models.question_report import QuestionReport
from app.schemas.question import (
    MCQ,
    OwnerOption,
    OwnerQuestion,
    PublicOption,
    PublicQuestion,
    QuestionContent,
    QuestionCreate,
    QuestionPatch,
    QuestionResponse,
    QuestionStatus,
    QuestionType,
    ShortAnswer,
    SourceReference,
    TrueFalse,
    content_adapter,
    normalize,
)
from app.services.courses import get_member_course
from app.services.moderation import course_moderator


def load_question(
    db: Session, user: User, question_id: UUID, *, mutate: bool = False
) -> tuple[Question, bool]:
    # Lock before checking visibility: a concurrent moderation transition cannot
    # pair stale authorization with freshly loaded private content.
    question = db.scalar(
        select(Question)
        .where(Question.id == question_id)
        .with_for_update(read=not mutate)
        .execution_options(populate_existing=True)
    )
    if question is None:
        raise HTTPException(404, "Question not found")
    moderator = course_moderator(db, user, question.course_id)
    if not moderator:
        get_member_course(db, user, question.course_id)
    full = moderator or question.created_by_user_id == user.id
    if not full and question.status != "APPROVED":
        raise HTTPException(404, "Question not found")
    return question, full


def require_creator(db: Session, user: User, question: Question) -> None:
    get_member_course(db, user, question.course_id)
    if question.created_by_user_id != user.id:
        raise HTTPException(403, "Only the creator may edit or submit this question")


def options(db: Session, question: Question) -> list[QuestionOption]:
    return list(
        db.scalars(
            select(QuestionOption)
            .where(QuestionOption.question_id == question.id)
            .order_by(QuestionOption.position)
        )
    )


def owner_view(db: Session, question: Question) -> OwnerQuestion:
    result = OwnerQuestion.model_validate(question)
    result.options = [
        OwnerOption(position=o.position, text=o.text, is_correct=o.is_correct)
        for o in options(db, question)
    ]
    result.concept_ids = list(
        db.scalars(
            select(QuestionConcept.concept_id)
            .where(QuestionConcept.question_id == question.id)
            .order_by(QuestionConcept.concept_id)
        )
    )
    result.source_chunks = [
        SourceReference(chunk_id=r.id, material_id=r.material_id, ordinal=r.ordinal)
        for r in db.execute(
            select(MaterialChunk.id, MaterialChunk.material_id, MaterialChunk.ordinal)
            .join(QuestionChunk, QuestionChunk.chunk_id == MaterialChunk.id)
            .where(QuestionChunk.question_id == question.id)
            .order_by(MaterialChunk.material_id, MaterialChunk.ordinal, MaterialChunk.id)
        )
    ]
    return result


def representation(db: Session, question: Question, owner: bool) -> QuestionResponse:
    if owner:
        return owner_view(db, question)
    # Explicit allowlist: explanations can reveal answers and are intentionally absent too.
    return PublicQuestion(
        id=question.id,
        course_id=question.course_id,
        type=cast(QuestionType, question.type),
        stem=question.stem,
        difficulty=question.difficulty,
        options=[PublicOption(position=o.position, text=o.text) for o in options(db, question)],
    )


def read_question(db: Session, user: User, question_id: UUID) -> QuestionResponse:
    question, owner = load_question(db, user, question_id)
    return representation(db, question, owner)


def list_questions(
    db: Session,
    user: User,
    course_id: UUID,
    status: QuestionStatus | None,
    type_: QuestionType | None,
    limit: int,
    offset: int,
) -> list[QuestionResponse]:
    get_member_course(db, user, course_id)
    moderator = course_moderator(db, user, course_id)
    query = select(Question).where(Question.course_id == course_id)
    if not moderator:
        query = query.where(
            or_(Question.status == "APPROVED", Question.created_by_user_id == user.id)
        )
    if status:
        query = query.where(Question.status == status)
    if type_:
        query = query.where(Question.type == type_)
    rows = db.scalars(
        query.order_by(Question.created_at.desc(), Question.id)
        .limit(limit)
        .offset(offset)
        .with_for_update(read=True)
    )
    return [representation(db, row, moderator or row.created_by_user_id == user.id) for row in rows]


def validate_concepts(db: Session, course_id: UUID, ids: list[UUID]) -> list[Concept]:
    if not ids or len(set(ids)) != len(ids):
        raise HTTPException(422, "Select unique approved concepts")
    rows = list(
        db.scalars(
            select(Concept)
            .where(
                Concept.id.in_(ids), Concept.course_id == course_id, Concept.status == "APPROVED"
            )
            .order_by(Concept.id)
            .execution_options(populate_existing=True)
        )
    )
    if len(rows) != len(ids):
        raise HTTPException(422, "Select approved concepts from this course")
    return rows


def validate_sources(db: Session, course_id: UUID, ids: list[UUID]) -> None:
    count = db.scalar(
        select(func.count())
        .select_from(MaterialChunk)
        .join(Material)
        .where(
            MaterialChunk.id.in_(ids), Material.course_id == course_id, Material.status == "READY"
        )
    )
    if not ids or count != len(set(ids)):
        raise HTTPException(409, "Question sources are no longer available")


def validate_provenance(db: Session, question: Question, concepts: list[UUID]) -> None:
    # User-supplied imports have no verified retrieval provenance. Internal AI keeps
    # its existing requirements, including when a generation job is later deleted.
    if question.source == "AI" or concepts:
        validate_concepts(db, question.course_id, concepts)
    sources = [s.chunk_id for s in owner_view(db, question).source_chunks]
    if question.source == "AI" or sources:
        validate_sources(db, question.course_id, sources)


def current_content(db: Session, question: Question) -> dict[str, object]:
    result: dict[str, object] = {
        "type": question.type,
        "stem": question.stem,
        "explanation": question.explanation,
        "difficulty": question.difficulty,
    }
    if question.type == "MULTIPLE_CHOICE":
        result["options"] = [
            {"text": o.text, "is_correct": o.is_correct} for o in options(db, question)
        ]
    elif question.type == "TRUE_FALSE":
        result["correct_answer"] = question.correct_boolean
    else:
        result["reference_answer"] = question.reference_answer
    return result


def save_content(db: Session, question: Question, content: QuestionContent) -> None:
    question.stem = content.stem
    question.normalized_stem = normalize(content.stem)
    question.explanation = content.explanation
    question.difficulty = content.difficulty
    question.correct_boolean = content.correct_answer if isinstance(content, TrueFalse) else None
    question.reference_answer = (
        content.reference_answer if isinstance(content, ShortAnswer) else None
    )
    db.flush([question])
    db.execute(delete(QuestionOption).where(QuestionOption.question_id == question.id))
    if isinstance(content, MCQ):
        for index, option in enumerate(content.options):
            db.add(
                QuestionOption(
                    question_id=question.id,
                    position=index,
                    text=option.text,
                    is_correct=option.is_correct,
                )
            )


def add_version(db: Session, question: Question, user: User, reason: str) -> None:
    db.flush()
    number = (
        db.scalar(
            select(func.max(QuestionVersion.version_number)).where(
                QuestionVersion.question_id == question.id
            )
        )
        or 0
    )
    db.add(
        QuestionVersion(
            question_id=question.id,
            version_number=number + 1,
            snapshot=owner_view(db, question).model_dump(mode="json"),
            changed_by_user_id=user.id,
            reason=reason,
        )
    )


def create_question(
    db: Session, user: User, course_id: UUID, data: QuestionCreate
) -> OwnerQuestion:
    get_member_course(db, user, course_id)
    try:
        concepts = validate_concepts(db, course_id, data.concept_ids) if data.concept_ids else []
        question = Question(
            id=uuid4(),
            course_id=course_id,
            created_by_user_id=user.id,
            type=data.type,
            status="DRAFT",
            source="USER",
            ai_job_id=None,
        )
        db.add(question)
        save_content(db, question, data)
        for concept in concepts:
            db.add(QuestionConcept(question_id=question.id, concept_id=concept.id))
        add_version(db, question, user, "CREATED")
        result = owner_view(db, question)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Duplicate active question stem or conflicting change") from None
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not create question") from None
    return result


def edit_question(
    db: Session, user: User, question_id: UUID, patch: QuestionPatch
) -> OwnerQuestion:
    question, _ = load_question(db, user, question_id, mutate=True)
    require_creator(db, user, question)
    if question.status not in ("DRAFT", "REJECTED"):
        raise HTTPException(409, "Only DRAFT or REJECTED questions can be edited")
    changes = patch.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(422, "Provide a content change")
    concepts = changes.pop("concept_ids", owner_view(db, question).concept_ids)
    if concepts is None:
        raise HTTPException(422, "Concepts are required")
    validate_provenance(db, question, concepts)
    try:
        content = content_adapter.validate_python(current_content(db, question) | changes)
    except ValidationError:
        raise HTTPException(422, "Invalid question content or answer shape") from None
    try:
        save_content(db, question, content)
        db.execute(delete(QuestionConcept).where(QuestionConcept.question_id == question.id))
        for id_ in sorted(concepts):
            db.add(QuestionConcept(question_id=question.id, concept_id=id_))
        question.status = "DRAFT"
        question.reviewed_by_user_id = None
        question.reviewed_at = None
        question.rejection_reason = None
        add_version(db, question, user, "EDITED")
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Duplicate active question stem or conflicting change") from None
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not save question") from None
    return owner_view(db, question)


TRANSITIONS = {
    "submit": ("DRAFT", "PENDING_REVIEW", "SUBMITTED"),
    "approve": ("PENDING_REVIEW", "APPROVED", "APPROVED"),
    "reject": ("PENDING_REVIEW", "REJECTED", "REJECTED"),
    "archive": ("APPROVED", "ARCHIVED", "ARCHIVED"),
}


def transition(
    db: Session, user: User, question_id: UUID, action: str, reason: str | None = None
) -> OwnerQuestion:
    question, _ = load_question(db, user, question_id, mutate=True)
    if action == "submit":
        require_creator(db, user, question)
    elif not course_moderator(db, user, question.course_id):
        raise HTTPException(403, "Faculty moderator access required")
    elif action in ("approve", "reject") and question.created_by_user_id == user.id:
        raise HTTPException(403, "Creators cannot review their own question")
    old, new, version_reason = TRANSITIONS[action]
    if question.status != old:
        raise HTTPException(409, "Invalid question lifecycle transition")
    if action in ("submit", "approve"):
        view = owner_view(db, question)
        validate_provenance(db, question, view.concept_ids)
        try:
            content_adapter.validate_python(current_content(db, question))
        except ValidationError:
            raise HTTPException(409, "Question content requires rework") from None
    if action == "reject" and (not reason or not reason.strip() or len(reason) > 1000):
        raise HTTPException(422, "A rejection reason is required")
    question.status = new
    if action in ("approve", "reject"):
        question.reviewed_by_user_id = user.id
        question.reviewed_at = datetime.now(UTC)
        question.rejection_reason = reason.strip() if action == "reject" and reason else None
    try:
        if action == "archive":
            archive_time = datetime.now(UTC)
            db.execute(
                update(QuestionReport)
                .where(QuestionReport.question_id == question.id, QuestionReport.status == "OPEN")
                .values(
                    status="RESOLVED",
                    resolution="QUESTION_ARCHIVED",
                    resolved_by_user_id=user.id,
                    resolved_at=archive_time,
                )
            )
            db.execute(
                update(QuestionEditSuggestion)
                .where(
                    QuestionEditSuggestion.question_id == question.id,
                    QuestionEditSuggestion.status == "OPEN",
                )
                .values(
                    status="RESOLVED",
                    resolution="QUESTION_ARCHIVED",
                    resolved_by_user_id=user.id,
                    resolved_at=archive_time,
                )
            )
        add_version(db, question, user, version_reason)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            409, "Question conflicts with existing content; review not saved"
        ) from None
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not save question transition") from None
    return owner_view(db, question)


def versions(
    db: Session, user: User, question_id: UUID, limit: int, offset: int
) -> list[QuestionVersion]:
    question, full = load_question(db, user, question_id)
    if not full:
        raise HTTPException(403, "Creator or faculty moderator access required")
    return list(
        db.scalars(
            select(QuestionVersion)
            .where(QuestionVersion.question_id == question_id)
            .order_by(QuestionVersion.version_number)
            .limit(limit)
            .offset(offset)
        )
    )
