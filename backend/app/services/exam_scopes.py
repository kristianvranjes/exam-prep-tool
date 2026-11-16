from typing import cast
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import case, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User
from app.models.course_unit import CourseUnit, QuestionUnit
from app.models.exam_scope import ExamScope, ExamScopeUnit
from app.models.question import Question
from app.models.user_question_progress import UserQuestionProgress
from app.schemas.exam_scope import (
    MAX_EXAM_SCOPES,
    ExamScopeCopy,
    ExamScopeCoverage,
    ExamScopeCreate,
    ExamScopeKind,
    ExamScopeResponse,
    ExamScopeUpdate,
    check_dates,
)
from app.schemas.question import normalize
from app.services.course_units import lock_course, validate_unit_links
from app.services.courses import get_member_course, get_owner_course

KIND_ORDER = case(
    (ExamScope.kind == "MIDTERM", 0),
    (ExamScope.kind == "FINAL", 1),
    (ExamScope.kind == "FULL_EXAM", 2),
    (ExamScope.kind == "LAB", 3),
    else_=4,
)
DUPLICATE = "An exam scope with this name already exists in that academic year"


def scope_unit_ids(db: Session, scope_ids: list[UUID]) -> dict[UUID, list[UUID]]:
    result: dict[UUID, list[UUID]] = {id_: [] for id_ in scope_ids}
    for scope_id, unit_id in db.execute(
        select(ExamScopeUnit.scope_id, ExamScopeUnit.unit_id)
        .join(CourseUnit, CourseUnit.id == ExamScopeUnit.unit_id)
        .where(ExamScopeUnit.scope_id.in_(scope_ids))
        .order_by(ExamScopeUnit.scope_id, CourseUnit.position, CourseUnit.id)
    ):
        result[scope_id].append(unit_id)
    return result


def responses(db: Session, scopes: list[ExamScope]) -> list[ExamScopeResponse]:
    ids = [scope.id for scope in scopes]
    units = scope_unit_ids(db, ids)
    # A question in several units of one scope counts once.
    counts: dict[UUID, int] = {
        scope_id: count
        for scope_id, count in db.execute(
            select(ExamScopeUnit.scope_id, func.count(func.distinct(Question.id)))
            .join(QuestionUnit, QuestionUnit.unit_id == ExamScopeUnit.unit_id)
            .join(Question, Question.id == QuestionUnit.question_id)
            .where(ExamScopeUnit.scope_id.in_(ids), Question.status == "APPROVED")
            .group_by(ExamScopeUnit.scope_id)
        )
    }
    return [
        ExamScopeResponse(
            id=scope.id,
            course_id=scope.course_id,
            academic_year=scope.academic_year,
            kind=cast(ExamScopeKind, scope.kind),
            name=scope.name,
            unit_ids=units[scope.id],
            starts_on=scope.starts_on,
            ends_on=scope.ends_on,
            approved_question_count=counts.get(scope.id, 0),
            created_at=scope.created_at,
            updated_at=scope.updated_at,
        )
        for scope in scopes
    ]


def list_scopes(
    db: Session, user: User, course_id: UUID, academic_year: str | None
) -> list[ExamScopeResponse]:
    get_member_course(db, user, course_id)
    query = select(ExamScope).where(ExamScope.course_id == course_id)
    if academic_year:
        query = query.where(ExamScope.academic_year == academic_year)
    scopes = list(
        db.scalars(
            query.order_by(
                ExamScope.academic_year.desc(), KIND_ORDER, ExamScope.normalized_name, ExamScope.id
            )
        )
    )
    return responses(db, scopes)


def replace_units(db: Session, scope_id: UUID, unit_ids: list[UUID]) -> None:
    db.execute(delete(ExamScopeUnit).where(ExamScopeUnit.scope_id == scope_id))
    for unit_id in sorted(unit_ids):
        db.add(ExamScopeUnit(scope_id=scope_id, unit_id=unit_id))


def commit_scopes(db: Session, scopes: list[ExamScope]) -> list[ExamScopeResponse]:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, DUPLICATE) from None
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not save exam scope") from None
    for scope in scopes:
        db.refresh(scope)
    return responses(db, scopes)


def scope_count(db: Session, course_id: UUID) -> int:
    return (
        db.scalar(
            select(func.count()).select_from(ExamScope).where(ExamScope.course_id == course_id)
        )
        or 0
    )


def create_scope(
    db: Session, user: User, course_id: UUID, data: ExamScopeCreate
) -> ExamScopeResponse:
    get_owner_course(db, user, course_id)
    lock_course(db, course_id)
    try:
        if scope_count(db, course_id) >= MAX_EXAM_SCOPES:
            raise HTTPException(409, f"A course can have at most {MAX_EXAM_SCOPES} exam scopes")
        units = validate_unit_links(db, course_id, data.unit_ids)
    except HTTPException:
        db.rollback()
        raise
    scope = ExamScope(
        course_id=course_id,
        academic_year=data.academic_year,
        kind=data.kind,
        name=data.name,
        normalized_name=normalize(data.name),
        starts_on=data.starts_on,
        ends_on=data.ends_on,
        created_by_user_id=user.id,
    )
    db.add(scope)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, DUPLICATE) from None
    replace_units(db, scope.id, units)
    return commit_scopes(db, [scope])[0]


def load_owned_scope(db: Session, user: User, scope_id: UUID) -> ExamScope:
    course_id = db.scalar(select(ExamScope.course_id).where(ExamScope.id == scope_id))
    if course_id is None:
        raise HTTPException(404, "Exam scope not found")
    get_owner_course(db, user, course_id)
    lock_course(db, course_id)
    scope = db.scalar(
        select(ExamScope)
        .where(ExamScope.id == scope_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if scope is None:
        raise HTTPException(404, "Exam scope not found")
    return scope


def update_scope(
    db: Session, user: User, scope_id: UUID, data: ExamScopeUpdate
) -> ExamScopeResponse:
    scope = load_owned_scope(db, user, scope_id)
    try:
        if data.unit_ids is not None:
            current = scope_unit_ids(db, [scope.id])[scope.id]
            replace_units(
                db, scope.id, validate_unit_links(db, scope.course_id, data.unit_ids, current)
            )
    except HTTPException:
        db.rollback()
        raise
    if data.academic_year is not None:
        scope.academic_year = data.academic_year
    if data.kind is not None:
        scope.kind = data.kind
    if data.name is not None:
        scope.name = data.name
        scope.normalized_name = normalize(data.name)
    if "starts_on" in data.model_fields_set:
        scope.starts_on = data.starts_on
    if "ends_on" in data.model_fields_set:
        scope.ends_on = data.ends_on
    try:
        check_dates(scope.starts_on, scope.ends_on)
    except ValueError as error:
        db.rollback()
        raise HTTPException(422, str(error)) from None
    return commit_scopes(db, [scope])[0]


def delete_scope(db: Session, user: User, scope_id: UUID) -> None:
    scope = load_owned_scope(db, user, scope_id)
    # Past practice keeps its frozen focus label; its scope reference becomes null.
    db.delete(scope)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not delete exam scope") from None


def copy_scopes(
    db: Session, user: User, course_id: UUID, data: ExamScopeCopy
) -> list[ExamScopeResponse]:
    get_owner_course(db, user, course_id)
    lock_course(db, course_id)
    sources = list(
        db.scalars(
            select(ExamScope)
            .where(ExamScope.course_id == course_id, ExamScope.academic_year == data.from_year)
            .order_by(KIND_ORDER, ExamScope.normalized_name, ExamScope.id)
        )
    )
    if not sources:
        db.rollback()
        raise HTTPException(404, f"No exam scopes exist for {data.from_year}")
    if scope_count(db, course_id) + len(sources) > MAX_EXAM_SCOPES:
        db.rollback()
        raise HTTPException(409, f"A course can have at most {MAX_EXAM_SCOPES} exam scopes")
    units = scope_unit_ids(db, [scope.id for scope in sources])
    active = set(
        db.scalars(
            select(CourseUnit.id).where(
                CourseUnit.course_id == course_id, CourseUnit.is_archived.is_(False)
            )
        )
    )
    created = []
    for source in sources:
        # A new year only links active units; scopes left without any are skipped.
        # Dates belong to one year, so copies start undated.
        kept = [unit_id for unit_id in units[source.id] if unit_id in active]
        if not kept:
            continue
        scope = ExamScope(
            course_id=course_id,
            academic_year=data.to_year,
            kind=source.kind,
            name=source.name,
            normalized_name=source.normalized_name,
            created_by_user_id=user.id,
        )
        db.add(scope)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, DUPLICATE) from None
        replace_units(db, scope.id, kept)
        created.append(scope)
    if not created:
        db.rollback()
        raise HTTPException(409, f"No scope in {data.from_year} has an active unit to copy")
    return commit_scopes(db, created)


def coverage(db: Session, user: User, scope_id: UUID) -> ExamScopeCoverage:
    course_id = db.scalar(select(ExamScope.course_id).where(ExamScope.id == scope_id))
    if course_id is None:
        raise HTTPException(404, "Exam scope not found")
    get_member_course(db, user, course_id)
    questions = (
        select(Question.id)
        .join(QuestionUnit, QuestionUnit.question_id == Question.id)
        .join(ExamScopeUnit, ExamScopeUnit.unit_id == QuestionUnit.unit_id)
        .where(ExamScopeUnit.scope_id == scope_id, Question.status == "APPROVED")
        .distinct()
        .subquery()
    )
    total = db.scalar(select(func.count()).select_from(questions)) or 0
    reviewed = (
        db.scalar(
            select(func.count())
            .select_from(UserQuestionProgress)
            .where(
                UserQuestionProgress.user_id == user.id,
                UserQuestionProgress.question_id.in_(select(questions.c.id)),
            )
        )
        or 0
    )
    return ExamScopeCoverage(scope_id=scope_id, question_count=total, reviewed_count=reviewed)


def resolve_focus(
    db: Session, course_id: UUID, unit_ids: list[UUID], exam_scope_id: UUID | None
) -> tuple[list[UUID], UUID | None, str | None]:
    """Expand a practice focus into units, a scope reference and a frozen label."""
    if exam_scope_id:
        scope = db.scalar(
            select(ExamScope)
            .where(ExamScope.id == exam_scope_id, ExamScope.course_id == course_id)
            .with_for_update(read=True)
        )
        if scope is None:
            raise HTTPException(404, "Exam scope not found")
        return (
            scope_unit_ids(db, [scope.id])[scope.id],
            scope.id,
            (f"{scope.name} {scope.academic_year}"),
        )
    if not unit_ids:
        return [], None, None
    rows = db.execute(
        select(CourseUnit.id, CourseUnit.title)
        .where(CourseUnit.id.in_(unit_ids), CourseUnit.course_id == course_id)
        .order_by(CourseUnit.position, CourseUnit.id)
        .with_for_update(read=True)
    ).all()
    if len(rows) != len(unit_ids):
        raise HTTPException(422, "Select units from this course")
    label = ", ".join(title for _, title in rows)
    return [id_ for id_, _ in rows], None, label if len(label) <= 300 else label[:299] + "…"
