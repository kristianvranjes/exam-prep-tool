from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.exam_estimate import ExamEstimate
from app.schemas.exam_scope import (
    AcademicYear,
    ExamScopeCopy,
    ExamScopeCoverage,
    ExamScopeCreate,
    ExamScopeResponse,
    ExamScopeUpdate,
)
from app.schemas.readiness import ExamScopeReadiness
from app.services import exam_estimate, readiness
from app.services import exam_scopes as service

router = APIRouter(tags=["exam scopes"])


@router.get("/courses/{course_id}/exam-scopes", response_model=list[ExamScopeResponse])
def list_scopes(
    course_id: UUID,
    academic_year: AcademicYear | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ExamScopeResponse]:
    return service.list_scopes(db, user, course_id, academic_year)


@router.post("/courses/{course_id}/exam-scopes", response_model=ExamScopeResponse, status_code=201)
def create(
    course_id: UUID,
    data: ExamScopeCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ExamScopeResponse:
    return service.create_scope(db, user, course_id, data)


@router.post(
    "/courses/{course_id}/exam-scopes/copy",
    response_model=list[ExamScopeResponse],
    status_code=201,
)
def copy(
    course_id: UUID,
    data: ExamScopeCopy,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ExamScopeResponse]:
    return service.copy_scopes(db, user, course_id, data)


@router.get("/exam-scopes/{scope_id}/coverage", response_model=ExamScopeCoverage)
def coverage(
    scope_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ExamScopeCoverage:
    return service.coverage(db, user, scope_id)


@router.get("/exam-scopes/{scope_id}/readiness", response_model=ExamScopeReadiness)
def get_readiness(
    scope_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ExamScopeReadiness:
    return readiness.scope_readiness(db, user, scope_id)


@router.get("/exam-scopes/{scope_id}/estimate", response_model=ExamEstimate)
def get_estimate(
    scope_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ExamEstimate:
    return exam_estimate.scope_estimate(db, user, scope_id)


@router.patch("/exam-scopes/{scope_id}", response_model=ExamScopeResponse)
def update(
    scope_id: UUID,
    data: ExamScopeUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ExamScopeResponse:
    return service.update_scope(db, user, scope_id, data)


@router.delete("/exam-scopes/{scope_id}", status_code=204)
def remove(
    scope_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    service.delete_scope(db, user, scope_id)
    return Response(status_code=204)
