import re
import unicodedata
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.models import Course, User
from app.models.faculty import Faculty
from app.models.faculty_creator import FacultyCreator
from app.models.faculty_moderator import FacultyModerator
from app.models.material import Material
from app.schemas.faculty import (
    FacultyCreate,
    FacultyResponse,
    FacultyUpdate,
    ManagedFacultyResponse,
)
from app.services.materials.cleanup import cleanup_sources, queue_sources
from app.services.materials.storage import MaterialStorage


def slugify(name: str) -> str:
    """'Fakultet elektrotehnike i računarstva' -> 'fakultet-elektrotehnike-i-racunarstva'."""
    ascii_name = (
        unicodedata.normalize("NFKD", name.replace("đ", "d").replace("Đ", "D"))
        .encode("ascii", "ignore")
        .decode()
    )
    return re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")[:100].rstrip("-")


def can_create_faculty(db: Session, user: User) -> bool:
    """Moderators of any active faculty may add faculties; there is no separate admin role."""
    return bool(
        db.scalar(
            select(
                exists().where(
                    FacultyModerator.user_id == user.id,
                    FacultyModerator.faculty_id == Faculty.id,
                    Faculty.is_active.is_(True),
                )
            )
        )
    )


def create_faculty(db: Session, user: User, data: FacultyCreate) -> Faculty:
    """Add a faculty and make its creator its first moderator, in one transaction.

    Creating a faculty grants moderation of that new faculty only, never of others.
    """
    if not can_create_faculty(db, user):
        raise HTTPException(403, "Faculty moderator access required")
    slug = data.slug or slugify(data.name)
    if not slug:
        raise HTTPException(422, "Enter a faculty name with letters or digits")
    faculty = Faculty(name=data.name, slug=slug, university_name=data.university_name)
    db.add(faculty)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A faculty with this address already exists") from None
    db.add(FacultyModerator(faculty_id=faculty.id, user_id=user.id))
    db.add(FacultyCreator(faculty_id=faculty.id, user_id=user.id))
    db.commit()
    db.refresh(faculty)
    return faculty


def require_faculty_manager(db: Session, user: User, faculty_id: UUID) -> None:
    """Editing, archiving, restoring and deleting a faculty is for the moderators of that faculty.

    Archived faculties count too, so the people who archived one can always bring it back. A
    moderator of another faculty, or anyone else, gets 403 whether or not the faculty exists.
    """
    moderates = db.scalar(
        select(
            exists().where(
                FacultyModerator.user_id == user.id, FacultyModerator.faculty_id == faculty_id
            )
        )
    )
    if not moderates:
        raise HTTPException(403, "Faculty moderator access required")


def course_counts(db: Session, faculty_ids: list[UUID]) -> dict[UUID, int]:
    if not faculty_ids:
        return {}
    rows = db.execute(
        select(Course.faculty_id, func.count())
        .where(Course.faculty_id.in_(faculty_ids))
        .group_by(Course.faculty_id)
    )
    return {faculty_id: count for faculty_id, count in rows}


def managed_row(faculty: Faculty, count: int) -> ManagedFacultyResponse:
    return ManagedFacultyResponse(
        **FacultyResponse.model_validate(faculty).model_dump(),
        is_active=faculty.is_active,
        course_count=count,
    )


def list_managed_faculties(
    db: Session, user: User, limit: int, offset: int
) -> list[ManagedFacultyResponse]:
    faculties = list(
        db.scalars(
            select(Faculty)
            .where(
                exists().where(
                    FacultyModerator.user_id == user.id, FacultyModerator.faculty_id == Faculty.id
                )
            )
            .order_by(Faculty.name, Faculty.id)
            .limit(limit)
            .offset(offset)
        )
    )
    counts = course_counts(db, [faculty.id for faculty in faculties])
    return [managed_row(faculty, counts.get(faculty.id, 0)) for faculty in faculties]


def lock_faculty(db: Session, user: User, faculty_id: UUID) -> Faculty:
    require_faculty_manager(db, user, faculty_id)
    faculty = db.scalar(
        select(Faculty)
        .where(Faculty.id == faculty_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if faculty is None:
        raise HTTPException(404, "Faculty not found")
    return faculty


def update_faculty(
    db: Session, user: User, faculty_id: UUID, data: FacultyUpdate
) -> ManagedFacultyResponse:
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is None:
        raise HTTPException(422, "Enter a faculty name")
    try:
        faculty = lock_faculty(db, user, faculty_id)
        for field, value in changes.items():
            setattr(faculty, field, value)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(faculty)
    return managed_row(faculty, course_counts(db, [faculty.id]).get(faculty.id, 0))


def set_faculty_active(
    db: Session, user: User, faculty_id: UUID, active: bool
) -> ManagedFacultyResponse:
    """Archive (hide from the catalog and from new courses) or restore a faculty.

    Its courses, their members and its moderators are left as they are.
    """
    try:
        faculty = lock_faculty(db, user, faculty_id)
        faculty.is_active = active
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(faculty)
    return managed_row(faculty, course_counts(db, [faculty.id]).get(faculty.id, 0))


def delete_faculty(db: Session, user: User, faculty_id: UUID) -> None:
    """Delete an archived faculty that has no courses at all, archived ones included."""
    try:
        # The update lock waits for course creation, which holds a share lock on an active faculty.
        faculty = lock_faculty(db, user, faculty_id)
        if faculty.is_active:
            raise HTTPException(409, "Archive the faculty before deleting it")
        if db.scalar(select(exists().where(Course.faculty_id == faculty_id))):
            raise HTTPException(409, "A faculty with courses cannot be deleted")
        db.delete(faculty)
        db.commit()
    except IntegrityError:
        # courses.faculty_id is ON DELETE RESTRICT: a course that appeared meanwhile still blocks.
        db.rollback()
        raise HTTPException(409, "A faculty with courses cannot be deleted") from None
    except Exception:
        db.rollback()
        raise


def delete_faculty_with_courses(
    db: Session, user: User, faculty_id: UUID, storage: MaterialStorage, confirm_name: str | None
) -> None:
    """Delete a faculty and every course in it, archived or not, once its name is typed.

    Each course goes as `delete_course` removes one (members, questions, attempts and the rest
    cascade); the source PDFs of its materials are cleaned up after the commit.
    """
    try:
        faculty = lock_faculty(db, user, faculty_id)
        if (confirm_name or "").strip() != faculty.name.strip():
            raise HTTPException(422, "Type the faculty name to confirm deletion")
        courses = list(
            db.scalars(
                select(Course)
                .where(Course.faculty_id == faculty_id)
                .order_by(Course.id)
                .with_for_update()
            )
        )
        keys = [
            key
            for key in db.scalars(
                select(Material.storage_key)
                .where(Material.course_id.in_([course.id for course in courses]))
                .order_by(Material.id)
                .with_for_update()
            )
        ]
        cleanup_ids = queue_sources(db, keys)
        for course in courses:
            db.delete(course)
        db.flush()
        db.delete(faculty)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not delete faculty") from None
    cleanup_sources(sessionmaker(bind=db.get_bind()), storage, cleanup_ids=cleanup_ids)


def active_faculty(db: Session, faculty_id: UUID) -> Faculty:
    faculty = db.scalar(
        select(Faculty)
        .where(Faculty.id == faculty_id, Faculty.is_active.is_(True))
        .with_for_update(read=True)
    )
    if faculty is None:
        raise HTTPException(404, "Faculty not found")
    return faculty


def list_faculties(db: Session, limit: int, offset: int) -> list[Faculty]:
    return list(
        db.scalars(
            select(Faculty)
            .where(Faculty.is_active.is_(True))
            .order_by(Faculty.name, Faculty.id)
            .limit(limit)
            .offset(offset)
        )
    )


def list_faculty_courses(db: Session, faculty_id: UUID, limit: int, offset: int) -> list[Course]:
    active_faculty(db, faculty_id)
    return list(
        db.scalars(
            select(Course)
            .where(Course.faculty_id == faculty_id, Course.is_active.is_(True))
            .order_by(Course.name, Course.id)
            .limit(limit)
            .offset(offset)
        )
    )
