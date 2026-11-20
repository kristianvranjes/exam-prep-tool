from collections.abc import Sequence
from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import delete, exists, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User
from app.models.concept import Concept
from app.models.course_unit import QuestionUnit
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
from app.schemas.course_unit import BulkQuestionUnits, BulkQuestionUnitsResult
from app.schemas.question import (
    MAX_QUESTION_UNITS,
    MCQ,
    BulkQuestionTransition,
    BulkQuestionTransitionResult,
    CircuitQuestion,
    Match,
    MultipleSelect,
    Numeric,
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
    TableQuestion,
    TrueFalse,
    WaveformQuestion,
    content_adapter,
    normalize,
    stem_key,
)
from app.services.course_units import (
    is_course_owner,
    question_unit_ids,
    replace_question_units,
    validate_unit_links,
)
from app.services.courses import get_member_course
from app.services.interactive import SPEC_FIELD, public_spec
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
        OwnerOption(
            position=o.position, text=o.text, is_correct=o.is_correct, match_text=o.match_text
        )
        for o in options(db, question)
    ]
    result.concept_ids = list(
        db.scalars(
            select(QuestionConcept.concept_id)
            .where(QuestionConcept.question_id == question.id)
            .order_by(QuestionConcept.concept_id)
        )
    )
    result.unit_ids = question_unit_ids(db, question.id)
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
    rows = options(db, question)
    return PublicQuestion(
        id=question.id,
        course_id=question.course_id,
        type=cast(QuestionType, question.type),
        stem=question.stem,
        difficulty=question.difficulty,
        options=[PublicOption(position=o.position, text=o.text) for o in rows],
        # Alphabetical, so the order says nothing about which item each belongs to.
        choices=[
            PublicOption(position=slot, text=text)
            for slot, text in enumerate(
                sorted((o.match_text for o in rows if o.match_text), key=normalize)
            )
        ],
        hint=question.hint,
        expr=question.expr,
        spec=public_spec(question.type, question.spec),
        unit_ids=question_unit_ids(db, question.id),
        unit=question.unit,
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
    unit_id: UUID | None = None,
    unassigned: bool = False,
) -> list[QuestionResponse]:
    get_member_course(db, user, course_id)
    if unit_id and unassigned:
        raise HTTPException(422, "Filter by one unit or by questions without units, not both")
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
    if unit_id:
        query = query.where(
            Question.id.in_(select(QuestionUnit.question_id).where(QuestionUnit.unit_id == unit_id))
        )
    if unassigned:
        query = query.where(~exists().where(QuestionUnit.question_id == Question.id))
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
        "hint": question.hint,
        "expr": question.expr,
    }
    if question.type in SPEC_FIELD:
        result[SPEC_FIELD[question.type]] = question.spec
    elif question.type == "MATCH":
        result["pairs"] = [
            {"left": o.text, "right": o.match_text or ""} for o in options(db, question)
        ]
    elif question.type in ("MULTIPLE_CHOICE", "MULTIPLE_SELECT"):
        result["options"] = [
            {"text": o.text, "is_correct": o.is_correct} for o in options(db, question)
        ]
    elif question.type == "TRUE_FALSE":
        result["correct_answer"] = question.correct_boolean
    elif question.type == "NUMERIC":
        result["correct_value"] = question.correct_value
        result["absolute_tolerance"] = question.absolute_tolerance
        result["relative_tolerance"] = question.relative_tolerance
        result["unit"] = question.unit
    else:
        result["reference_answer"] = question.reference_answer
    return result


def save_content(db: Session, question: Question, content: QuestionContent) -> None:
    question.stem = content.stem
    question.normalized_stem = stem_key(content)
    question.explanation = content.explanation
    question.difficulty = content.difficulty
    question.hint = content.hint
    question.expr = content.expr
    question.correct_boolean = content.correct_answer if isinstance(content, TrueFalse) else None
    question.reference_answer = (
        content.reference_answer if isinstance(content, ShortAnswer) else None
    )
    numeric = content if isinstance(content, Numeric) else None
    question.correct_value = numeric.correct_value if numeric else None
    question.absolute_tolerance = numeric.absolute_tolerance if numeric else None
    question.relative_tolerance = numeric.relative_tolerance if numeric else None
    question.unit = numeric.unit if numeric else None
    if isinstance(content, TableQuestion):
        question.spec = content.table.model_dump(mode="json", exclude_none=True)
    elif isinstance(content, CircuitQuestion):
        question.spec = content.circuit.model_dump(mode="json", exclude_none=True)
    elif isinstance(content, WaveformQuestion):
        question.spec = content.waveform.model_dump(mode="json", exclude_none=True)
    else:
        question.spec = None
    db.flush([question])
    db.execute(delete(QuestionOption).where(QuestionOption.question_id == question.id))
    if isinstance(content, MCQ | MultipleSelect):
        for index, option in enumerate(content.options):
            db.add(
                QuestionOption(
                    question_id=question.id,
                    position=index,
                    text=option.text,
                    is_correct=option.is_correct,
                )
            )
    elif isinstance(content, Match):
        for index, pair in enumerate(content.pairs):
            db.add(
                QuestionOption(
                    question_id=question.id,
                    position=index,
                    text=pair.left,
                    is_correct=True,
                    match_text=pair.right,
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
        units = validate_unit_links(db, course_id, data.unit_ids)
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
        replace_question_units(db, question.id, units)
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
    current_units = question_unit_ids(db, question.id)
    units = changes.pop("unit_ids", current_units)
    if units is None:
        raise HTTPException(422, "Units must be a list; send [] for none")
    validate_provenance(db, question, concepts)
    units = validate_unit_links(db, question.course_id, units, current_units)
    try:
        content = content_adapter.validate_python(current_content(db, question) | changes)
    except ValidationError:
        raise HTTPException(422, "Invalid question content or answer shape") from None
    try:
        save_content(db, question, content)
        db.execute(delete(QuestionConcept).where(QuestionConcept.question_id == question.id))
        for id_ in sorted(concepts):
            db.add(QuestionConcept(question_id=question.id, concept_id=id_))
        replace_question_units(db, question.id, units)
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
# Creators withdraw (archive) their own unpublished questions; shared ones need a moderator.
UNPUBLISHED = ("DRAFT", "PENDING_REVIEW", "REJECTED")


def check_transition(
    db: Session, user: User, question: Question, action: str, moderator: bool, owner: bool
) -> None:
    """Raise unless `user` may apply `action` to `question` in its current state.

    A course owner who is also a faculty moderator may approve their own question,
    straight from DRAFT; every other creator still needs a second reviewer.
    """
    creator = question.created_by_user_id == user.id
    allowed: tuple[str, ...] = (TRANSITIONS[action][0],)
    if action == "submit":
        require_creator(db, user, question)
    elif action == "archive" and creator and question.status in UNPUBLISHED:
        require_creator(db, user, question)
        allowed = UNPUBLISHED
    elif not moderator:
        raise HTTPException(403, "Faculty moderator access required")
    elif action in ("approve", "reject") and creator:
        if action == "reject" or not owner:
            raise HTTPException(403, "Creators cannot review their own question")
        allowed = ("DRAFT", "PENDING_REVIEW")
    if question.status not in allowed:
        raise HTTPException(409, "Invalid question lifecycle transition")


def apply_transition(
    db: Session, user: User, question: Question, action: str, reason: str | None = None
) -> None:
    """Change state and record history; the caller has checked access and commits."""
    if action in ("submit", "approve"):
        view = owner_view(db, question)
        validate_provenance(db, question, view.concept_ids)
        try:
            content_adapter.validate_python(current_content(db, question))
        except ValidationError:
            raise HTTPException(409, "Question content requires rework") from None
    if action == "reject" and (not reason or not reason.strip() or len(reason) > 1000):
        raise HTTPException(422, "A rejection reason is required")
    _, new, version_reason = TRANSITIONS[action]
    question.status = new
    if action in ("approve", "reject"):
        question.reviewed_by_user_id = user.id
        question.reviewed_at = datetime.now(UTC)
        question.rejection_reason = reason.strip() if action == "reject" and reason else None
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


def save_transitions(
    db: Session, user: User, questions: Sequence[Question], action: str, reason: str | None
) -> None:
    """Apply already-checked transitions and commit them together, or none of them."""
    try:
        for question in questions:
            apply_transition(db, user, question, action, reason)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            409, "Question conflicts with existing content; review not saved"
        ) from None
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not save question transition") from None


def transition(
    db: Session, user: User, question_id: UUID, action: str, reason: str | None = None
) -> OwnerQuestion:
    question, _ = load_question(db, user, question_id, mutate=True)
    moderator = course_moderator(db, user, question.course_id)
    owner = moderator and is_course_owner(db, user, question.course_id)
    try:
        check_transition(db, user, question, action, moderator, owner)
    except HTTPException:
        db.rollback()
        raise
    save_transitions(db, user, [question], action, reason)
    return owner_view(db, question)


def bulk_transition(
    db: Session, user: User, course_id: UUID, data: BulkQuestionTransition
) -> BulkQuestionTransitionResult:
    """Apply one lifecycle action to selected questions, all or nothing."""
    moderator = course_moderator(db, user, course_id)
    if not moderator:
        get_member_course(db, user, course_id)
    owner = moderator and is_course_owner(db, user, course_id)
    ids = sorted(data.question_ids)
    # Lock in ID order so concurrent bulk requests cannot deadlock each other.
    questions = db.scalars(
        select(Question)
        .where(Question.id.in_(ids), Question.course_id == course_id)
        .order_by(Question.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    if len(questions) != len(ids) or any(
        not moderator and q.status != "APPROVED" and q.created_by_user_id != user.id
        for q in questions
    ):
        raise HTTPException(404, "Question not found")
    refused: list[HTTPException] = []
    for question in questions:
        try:
            check_transition(db, user, question, data.action, moderator, owner)
        except HTTPException as error:
            refused.append(error)
    if refused:
        db.rollback()
        raise HTTPException(
            max(error.status_code for error in refused),
            f"{len(refused)} of {len(questions)} selected questions cannot be changed this way "
            f"({refused[0].detail}); nothing was saved",
        )
    save_transitions(db, user, questions, data.action, data.reason)
    return BulkQuestionTransitionResult(changed=len(questions))


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


def set_units(db: Session, user: User, question_id: UUID, unit_ids: list[UUID]) -> QuestionResponse:
    """Reorganize a question without a content version or another review.

    Units are course organization, not question content: owners and moderators may
    adjust approved questions, and pending edit suggestions stay valid.
    """
    question, full = load_question(db, user, question_id, mutate=True)
    manager = course_moderator(db, user, question.course_id) or is_course_owner(
        db, user, question.course_id
    )
    creator_draft = question.created_by_user_id == user.id and question.status in (
        "DRAFT",
        "REJECTED",
    )
    if not (manager or creator_draft):
        raise HTTPException(403, "Course owner or faculty moderator access required")
    if question.status == "ARCHIVED":
        raise HTTPException(409, "Archived questions cannot change units")
    try:
        units = validate_unit_links(
            db, question.course_id, unit_ids, question_unit_ids(db, question.id)
        )
        replace_question_units(db, question.id, units)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not save question units") from None
    return representation(db, question, full)


def bulk_set_units(
    db: Session, user: User, course_id: UUID, data: BulkQuestionUnits
) -> BulkQuestionUnitsResult:
    """Add or remove one unit across selected questions, all or nothing.

    Follows set_units for owners and moderators: organization only, so no content
    version or review. Questions that already match the request count as unchanged.
    """
    moderator = course_moderator(db, user, course_id)
    if not moderator:
        get_member_course(db, user, course_id)
        if not is_course_owner(db, user, course_id):
            raise HTTPException(403, "Course owner or faculty moderator access required")
    ids = sorted(data.question_ids)
    # Lock in ID order so concurrent bulk requests cannot deadlock each other.
    questions = db.scalars(
        select(Question)
        .where(Question.id.in_(ids), Question.course_id == course_id)
        .order_by(Question.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    # Owners who are not moderators see only approved questions and their own drafts.
    if len(questions) != len(ids) or any(
        not moderator and q.status != "APPROVED" and q.created_by_user_id != user.id
        for q in questions
    ):
        raise HTTPException(404, "Question not found")
    if any(q.status == "ARCHIVED" for q in questions):
        raise HTTPException(409, "Archived questions cannot change units")
    try:
        linked: dict[UUID, set[UUID]] = {question_id: set() for question_id in ids}
        for question_id, unit_id in db.execute(
            select(QuestionUnit.question_id, QuestionUnit.unit_id).where(
                QuestionUnit.question_id.in_(ids)
            )
        ):
            linked[question_id].add(unit_id)
        if data.action == "ADD":
            validate_unit_links(db, course_id, [data.unit_id])
            targets = [q for q in ids if data.unit_id not in linked[q]]
            if any(len(linked[q]) >= MAX_QUESTION_UNITS for q in targets):
                raise HTTPException(
                    422, f"A question can belong to at most {MAX_QUESTION_UNITS} units"
                )
            db.add_all(QuestionUnit(question_id=q, unit_id=data.unit_id) for q in targets)
        else:
            # Removing an archived unit is allowed, as in single-question edits.
            validate_unit_links(db, course_id, [data.unit_id], [data.unit_id])
            targets = [q for q in ids if data.unit_id in linked[q]]
            if targets:
                db.execute(
                    delete(QuestionUnit).where(
                        QuestionUnit.unit_id == data.unit_id, QuestionUnit.question_id.in_(targets)
                    )
                )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not save question units") from None
    return BulkQuestionUnitsResult(changed=len(targets), unchanged=len(ids) - len(targets))
