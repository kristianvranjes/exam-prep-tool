from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.course_unit import (
    CourseUnitCreate,
    CourseUnitOrder,
    CourseUnitResponse,
    CourseUnitUpdate,
)
from app.services import course_units as service

router = APIRouter(tags=["course units"])


@router.get("/courses/{course_id}/units", response_model=list[CourseUnitResponse])
def list_units(
    course_id: UUID,
    include_archived: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CourseUnitResponse]:
    return service.list_units(db, user, course_id, include_archived)


@router.post("/courses/{course_id}/units", response_model=CourseUnitResponse, status_code=201)
def create(
    course_id: UUID,
    data: CourseUnitCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseUnitResponse:
    return service.create_unit(db, user, course_id, data)


@router.patch("/courses/{course_id}/units/order", response_model=list[CourseUnitResponse])
def reorder(
    course_id: UUID,
    data: CourseUnitOrder,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CourseUnitResponse]:
    return service.reorder_units(db, user, course_id, data.unit_ids)


@router.patch("/units/{unit_id}", response_model=CourseUnitResponse)
def update(
    unit_id: UUID,
    data: CourseUnitUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseUnitResponse:
    return service.update_unit(db, user, unit_id, data)


@router.post("/units/{unit_id}/archive", response_model=CourseUnitResponse)
def archive(
    unit_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> CourseUnitResponse:
    return service.set_archived(db, user, unit_id, True)


@router.post("/units/{unit_id}/restore", response_model=CourseUnitResponse)
def restore(
    unit_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> CourseUnitResponse:
    return service.set_archived(db, user, unit_id, False)
