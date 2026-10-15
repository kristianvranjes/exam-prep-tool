from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.progress import ProgressResponse, ProgressSummary, UnitProgressSummary
from app.services.progress import list_progress, summarize_progress, summarize_unit_progress

router = APIRouter(prefix="/courses/{course_id}/review-progress", tags=["progress"])


@router.get("", response_model=list[ProgressResponse])
def get_course_progress(
    course_id: UUID,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ProgressResponse]:
    return list_progress(db, user, course_id, limit, offset)


@router.get("/summary", response_model=ProgressSummary)
def get_course_progress_summary(
    course_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProgressSummary:
    return summarize_progress(db, user, course_id)


@router.get("/units", response_model=UnitProgressSummary)
def get_course_unit_progress(
    course_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UnitProgressSummary:
    return summarize_unit_progress(db, user, course_id)
