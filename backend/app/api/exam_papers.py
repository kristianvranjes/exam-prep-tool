from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.exam_paper import (
    ExamPaperCreate,
    ExamPaperDetail,
    ExamPaperItems,
    ExamPaperList,
    ExamPaperUpdate,
)
from app.schemas.exam_scope import AcademicYear, ExamScopeKind
from app.services import exam_papers as service

router = APIRouter(tags=["exam papers"])


@router.get("/courses/{course_id}/exam-papers", response_model=ExamPaperList)
def list_papers(
    course_id: UUID,
    academic_year: AcademicYear | None = None,
    kind: ExamScopeKind | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ExamPaperList:
    return service.list_papers(db, user, course_id, academic_year, kind, limit, offset)


@router.post("/courses/{course_id}/exam-papers", response_model=ExamPaperDetail, status_code=201)
def create(
    course_id: UUID,
    data: ExamPaperCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ExamPaperDetail:
    return service.create_paper(db, user, course_id, data)


@router.get("/exam-papers/{paper_id}", response_model=ExamPaperDetail)
def read(
    paper_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ExamPaperDetail:
    return service.read_paper(db, user, paper_id)


@router.patch("/exam-papers/{paper_id}", response_model=ExamPaperDetail)
def update(
    paper_id: UUID,
    data: ExamPaperUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ExamPaperDetail:
    return service.update_paper(db, user, paper_id, data)


@router.post("/exam-papers/{paper_id}/items", response_model=ExamPaperDetail)
def set_items(
    paper_id: UUID,
    data: ExamPaperItems,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ExamPaperDetail:
    return service.set_items(db, user, paper_id, data)


@router.post("/exam-papers/{paper_id}/publish", response_model=ExamPaperDetail)
def publish(
    paper_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ExamPaperDetail:
    return service.publish(db, user, paper_id)


@router.post("/exam-papers/{paper_id}/unpublish", response_model=ExamPaperDetail)
def unpublish(
    paper_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ExamPaperDetail:
    return service.unpublish(db, user, paper_id)


@router.delete("/exam-papers/{paper_id}", status_code=204)
def remove(
    paper_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    service.delete_paper(db, user, paper_id)
    return Response(status_code=204)
