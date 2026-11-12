from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.models.faculty import Faculty
from app.schemas.course import CatalogCourse, CourseResponse
from app.schemas.faculty import FacultyCreate, FacultyCreation, FacultyResponse
from app.services.course_summaries import approved_counts
from app.services.faculties import (
    can_create_faculty,
    create_faculty,
    list_faculties,
    list_faculty_courses,
)

router = APIRouter(prefix="/faculties", tags=["faculties"])


@router.post("", response_model=FacultyResponse, status_code=201)
def add_faculty(
    data: FacultyCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Faculty:
    return create_faculty(db, user, data)


@router.get("/can-create", response_model=FacultyCreation)
def faculty_creation(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> FacultyCreation:
    return FacultyCreation(can_create=can_create_faculty(db, user))


@router.get("", response_model=list[FacultyResponse])
def catalog(
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Faculty]:
    return list_faculties(db, limit, offset)


@router.get("/{faculty_id}/courses", response_model=list[CatalogCourse])
def courses(
    faculty_id: UUID,
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CatalogCourse]:
    rows = list_faculty_courses(db, faculty_id, limit, offset)
    counts = approved_counts(db, [course.id for course in rows])
    return [
        CatalogCourse(
            **CourseResponse.model_validate(course).model_dump(),
            approved_question_count=counts.get(course.id, 0),
        )
        for course in rows
    ]
