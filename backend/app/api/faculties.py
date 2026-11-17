from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.models.faculty import Faculty
from app.schemas.course import CatalogCourseResponse
from app.schemas.faculty import (
    FacultyCreate,
    FacultyCreation,
    FacultyResponse,
    FacultyUpdate,
    ManagedFacultyResponse,
)
from app.services.course_summaries import list_catalog_courses
from app.services.faculties import (
    can_create_faculty,
    create_faculty,
    delete_faculty,
    list_faculties,
    list_managed_faculties,
    set_faculty_active,
    update_faculty,
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


@router.get("/manage", response_model=list[ManagedFacultyResponse])
def managed(
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ManagedFacultyResponse]:
    return list_managed_faculties(db, user, limit, offset)


@router.patch("/{faculty_id}", response_model=ManagedFacultyResponse)
def edit(
    faculty_id: UUID,
    data: FacultyUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ManagedFacultyResponse:
    return update_faculty(db, user, faculty_id, data)


@router.post("/{faculty_id}/archive", response_model=ManagedFacultyResponse)
def archive(
    faculty_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ManagedFacultyResponse:
    return set_faculty_active(db, user, faculty_id, active=False)


@router.post("/{faculty_id}/restore", response_model=ManagedFacultyResponse)
def restore(
    faculty_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ManagedFacultyResponse:
    return set_faculty_active(db, user, faculty_id, active=True)


@router.delete("/{faculty_id}", status_code=204)
def remove(
    faculty_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    delete_faculty(db, user, faculty_id)
    return Response(status_code=204)


@router.get("", response_model=list[FacultyResponse])
def catalog(
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Faculty]:
    return list_faculties(db, limit, offset)


@router.get("/{faculty_id}/courses", response_model=list[CatalogCourseResponse])
def courses(
    faculty_id: UUID,
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CatalogCourseResponse]:
    return list_catalog_courses(db, faculty_id, limit, offset)
