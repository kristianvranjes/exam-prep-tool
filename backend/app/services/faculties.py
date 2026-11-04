import re
import unicodedata
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Course, User
from app.models.faculty import Faculty
from app.models.faculty_creator import FacultyCreator
from app.models.faculty_moderator import FacultyModerator
from app.schemas.faculty import FacultyCreate


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
