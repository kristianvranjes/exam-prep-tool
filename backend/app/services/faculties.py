from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Course
from app.models.faculty import Faculty


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
