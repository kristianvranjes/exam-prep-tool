from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import Course, User
from app.models.faculty import Faculty
from app.schemas.course import CourseResponse
from app.schemas.faculty import FacultyResponse
from app.services.faculties import list_faculties, list_faculty_courses

router = APIRouter(prefix="/faculties", tags=["faculties"])


@router.get("", response_model=list[FacultyResponse])
def catalog(
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Faculty]:
    return list_faculties(db, limit, offset)


@router.get("/{faculty_id}/courses", response_model=list[CourseResponse])
def courses(
    faculty_id: UUID,
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Course]:
    return list_faculty_courses(db, faculty_id, limit, offset)
