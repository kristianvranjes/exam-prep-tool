from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.course_unit import (
    CourseUnitCreate,
    CourseUnitMerge,
    CourseUnitOrder,
    CourseUnitResponse,
    CourseUnitUpdate,
)
from app.schemas.unit_moderation import (
    QuestionTable,
    TableFilter,
    UnitModerationDetail,
    UnitModerationRow,
    UnitStatusChange,
)
from app.services import course_units as service
from app.services import unit_moderation

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


@router.post("/units/{unit_id}/merge", response_model=CourseUnitResponse)
def merge(
    unit_id: UUID,
    data: CourseUnitMerge,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseUnitResponse:
    return service.merge_units(db, user, unit_id, data)


@router.get("/courses/{course_id}/units/moderation", response_model=list[UnitModerationRow])
def moderation_list(
    course_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[UnitModerationRow]:
    return unit_moderation.list_units(db, user, course_id)


@router.get("/courses/{course_id}/question-table", response_model=QuestionTable)
def question_table(
    course_id: UUID,
    unit: str | None = Query(default=None, max_length=64),
    show: TableFilter = "ALL",
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QuestionTable:
    return unit_moderation.question_table(db, user, course_id, unit, show, q, limit, offset)


@router.get("/units/{unit_id}/moderation", response_model=UnitModerationDetail)
def moderation_detail(
    unit_id: UUID,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UnitModerationDetail:
    return unit_moderation.unit_detail(db, user, unit_id, limit, offset)


@router.post("/units/{unit_id}/status", response_model=CourseUnitResponse)
def change_status(
    unit_id: UUID,
    data: UnitStatusChange,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseUnitResponse:
    return unit_moderation.set_status(db, user, unit_id, data.status)
