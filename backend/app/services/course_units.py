from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, literal, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Course, CourseMembership, MembershipRole, User
from app.models.course_unit import CourseUnit, QuestionUnit
from app.models.exam_scope import ExamScopeUnit
from app.models.question import Question
from app.schemas.course_unit import (
    MAX_COURSE_UNITS,
    CourseUnitCreate,
    CourseUnitMerge,
    CourseUnitResponse,
    CourseUnitUpdate,
    UnitPerson,
)
from app.schemas.question import normalize
from app.services.courses import get_member_course, get_owner_course
from app.services.platform_owner import is_platform_owner


def is_course_owner(db: Session, user: User, course_id: UUID) -> bool:
    role = db.scalar(
        select(CourseMembership.role).where(
            CourseMembership.course_id == course_id, CourseMembership.user_id == user.id
        )
    )
    return role == MembershipRole.OWNER.value or is_platform_owner(user)


def lock_course(db: Session, course_id: UUID) -> None:
    # Every unit mutation serializes on the course row: positions stay dense and
    # validation of unit links cannot race with archive/reorder.
    if db.scalar(select(Course.id).where(Course.id == course_id).with_for_update()) is None:
        raise HTTPException(404, "Course not found")


def course_units(db: Session, course_id: UUID, include_archived: bool) -> list[CourseUnit]:
    query = select(CourseUnit).where(CourseUnit.course_id == course_id)
    if not include_archived:
        query = query.where(CourseUnit.is_archived.is_(False))
    return list(
        db.scalars(
            query.order_by(CourseUnit.position, CourseUnit.id).execution_options(
                populate_existing=True
            )
        )
    )


def people(db: Session, ids: set[UUID | None]) -> dict[UUID, UnitPerson]:
    wanted = [id_ for id_ in ids if id_ is not None]
    if not wanted:
        return {}
    return {
        id_: UnitPerson(id=id_, display_name=name)
        for id_, name in db.execute(select(User.id, User.display_name).where(User.id.in_(wanted)))
    }


def responses(db: Session, course_id: UUID, units: list[CourseUnit]) -> list[CourseUnitResponse]:
    counts: dict[UUID, int] = {
        unit_id: count
        for unit_id, count in db.execute(
            select(QuestionUnit.unit_id, func.count())
            .join(Question, Question.id == QuestionUnit.question_id)
            .where(Question.course_id == course_id, Question.status == "APPROVED")
            .group_by(QuestionUnit.unit_id)
        )
    }
    named = people(
        db, {id_ for unit in units for id_ in (unit.created_by_user_id, unit.reviewer_id)}
    )
    result = []
    for unit in units:
        row = CourseUnitResponse.model_validate(unit)
        row.approved_question_count = counts.get(unit.id, 0)
        row.author = named.get(unit.created_by_user_id)
        row.reviewer = named.get(unit.reviewer_id) if unit.reviewer_id else None
        result.append(row)
    return result


def list_units(
    db: Session, user: User, course_id: UUID, include_archived: bool
) -> list[CourseUnitResponse]:
    get_member_course(db, user, course_id)
    return responses(db, course_id, course_units(db, course_id, include_archived))


def commit_unit(db: Session, unit: CourseUnit) -> CourseUnitResponse:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A unit with this title already exists in the course") from None
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not save unit") from None
    db.refresh(unit)
    return responses(db, unit.course_id, [unit])[0]


def create_unit(
    db: Session, user: User, course_id: UUID, data: CourseUnitCreate
) -> CourseUnitResponse:
    get_owner_course(db, user, course_id)
    lock_course(db, course_id)
    total, last = db.execute(
        select(func.count(), func.max(CourseUnit.position)).where(CourseUnit.course_id == course_id)
    ).one()
    if total >= MAX_COURSE_UNITS:
        db.rollback()
        raise HTTPException(409, f"A course can have at most {MAX_COURSE_UNITS} units")
    unit = CourseUnit(
        course_id=course_id,
        position=0 if last is None else last + 1,
        title=data.title,
        normalized_title=normalize(data.title),
        description=data.description,
        is_archived=False,
        created_by_user_id=user.id,
    )
    db.add(unit)
    return commit_unit(db, unit)


def load_owned_unit(db: Session, user: User, unit_id: UUID) -> CourseUnit:
    course_id = db.scalar(select(CourseUnit.course_id).where(CourseUnit.id == unit_id))
    if course_id is None:
        raise HTTPException(404, "Unit not found")
    get_owner_course(db, user, course_id)
    lock_course(db, course_id)
    unit = db.scalar(
        select(CourseUnit)
        .where(CourseUnit.id == unit_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if unit is None:
        raise HTTPException(404, "Unit not found")
    return unit


def update_unit(
    db: Session, user: User, unit_id: UUID, data: CourseUnitUpdate
) -> CourseUnitResponse:
    unit = load_owned_unit(db, user, unit_id)
    if "title" in data.model_fields_set and data.title is not None:
        unit.title = data.title
        unit.normalized_title = normalize(data.title)
    if "description" in data.model_fields_set:
        unit.description = data.description
    return commit_unit(db, unit)


def set_archived(db: Session, user: User, unit_id: UUID, archived: bool) -> CourseUnitResponse:
    unit = load_owned_unit(db, user, unit_id)
    unit.is_archived = archived
    return commit_unit(db, unit)


def merge_units(
    db: Session, user: User, unit_id: UUID, data: CourseUnitMerge
) -> CourseUnitResponse:
    """Fold one unit into another: its questions and exam scopes move to the target.

    The source is deleted, not archived, so a split such as "Part 1/3, 2/3, 3/3" does not linger
    in the archive. Questions already in the target are not duplicated. Progress, readiness and
    review decks are derived from these links, so they follow without further changes.
    """
    source = load_owned_unit(db, user, unit_id)
    if data.into_unit_id == source.id:
        db.rollback()
        raise HTTPException(422, "Choose a different unit to merge into")
    target = db.scalar(
        select(CourseUnit)
        .where(CourseUnit.id == data.into_unit_id, CourseUnit.course_id == source.course_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if target is None or target.is_archived:
        db.rollback()
        raise HTTPException(422, "Select an active unit from this course")
    try:
        for link, key in (
            (QuestionUnit, QuestionUnit.question_id),
            (ExamScopeUnit, ExamScopeUnit.scope_id),
        ):
            moved = select(key, literal(target.id)).where(link.unit_id == source.id)
            db.execute(
                insert(link).from_select([key.key, "unit_id"], moved).on_conflict_do_nothing()
            )
        # The source's own links go with it (ON DELETE CASCADE), after they were copied.
        db.delete(source)
        db.flush()
        remaining = course_units(db, target.course_id, include_archived=True)
        for position, unit in enumerate(remaining):
            unit.position = position
        # After the listing: that query reloads rows, and the session does not autoflush, so a
        # rename made before it would be lost.
        if "title" in data.model_fields_set and data.title is not None:
            target.title = data.title
            target.normalized_title = normalize(data.title)
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not merge units") from None
    return commit_unit(db, target)


def reorder_units(
    db: Session, user: User, course_id: UUID, unit_ids: list[UUID]
) -> list[CourseUnitResponse]:
    get_owner_course(db, user, course_id)
    lock_course(db, course_id)
    units = course_units(db, course_id, include_archived=True)
    active = {unit.id: unit for unit in units if not unit.is_archived}
    if len(unit_ids) != len(active) or set(unit_ids) != set(active):
        db.rollback()
        raise HTTPException(422, "List every active unit of this course exactly once")
    # Archived units keep their relative order after the active ones.
    ordered = [active[id_] for id_ in unit_ids] + [unit for unit in units if unit.is_archived]
    for position, unit in enumerate(ordered):
        unit.position = position
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not save unit order") from None
    return responses(db, course_id, course_units(db, course_id, include_archived=True))


def validate_unit_links(
    db: Session, course_id: UUID, unit_ids: list[UUID], current: list[UUID] | None = None
) -> list[UUID]:
    """Return sorted IDs of course units a question may link to.

    New links need an active unit; links the question already has may stay when
    their unit was archived later, so an edit never silently drops organization.
    """
    if len(set(unit_ids)) != len(unit_ids):
        raise HTTPException(422, "Select unique units")
    if not unit_ids:
        return []
    rows = db.execute(
        select(CourseUnit.id, CourseUnit.is_archived)
        .where(CourseUnit.id.in_(unit_ids), CourseUnit.course_id == course_id)
        .with_for_update(read=True)
    ).all()
    kept = set(current or [])
    if len(rows) != len(unit_ids) or any(archived and id_ not in kept for id_, archived in rows):
        raise HTTPException(422, "Select active units from this course")
    return sorted(unit_ids)


def question_unit_ids(db: Session, question_id: UUID) -> list[UUID]:
    return list(
        db.scalars(
            select(QuestionUnit.unit_id)
            .where(QuestionUnit.question_id == question_id)
            .order_by(QuestionUnit.unit_id)
        )
    )


def replace_question_units(db: Session, question_id: UUID, unit_ids: list[UUID]) -> None:
    db.execute(delete(QuestionUnit).where(QuestionUnit.question_id == question_id))
    for unit_id in sorted(unit_ids):
        db.add(QuestionUnit(question_id=question_id, unit_id=unit_id))
