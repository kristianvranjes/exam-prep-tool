from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Course, User
from app.models.faculty import Faculty
from app.models.faculty_moderator import FacultyModerator
from app.services.platform_owner import is_platform_owner


def is_moderator(db: Session, user_id: UUID, faculty_id: UUID) -> bool:
    return db.get(FacultyModerator, (faculty_id, user_id)) is not None


def require_moderator(db: Session, user: User, faculty_id: UUID) -> None:
    if db.get(Faculty, faculty_id) is None:
        raise HTTPException(404, "Faculty not found")
    if not is_moderator(db, user.id, faculty_id) and not is_platform_owner(user):
        raise HTTPException(403, "Faculty moderator access required")


def course_moderator(db: Session, user: User, course_id: UUID) -> bool:
    faculty_id = db.scalar(select(Course.faculty_id).where(Course.id == course_id))
    return faculty_id is not None and (
        is_moderator(db, user.id, faculty_id) or is_platform_owner(user)
    )
