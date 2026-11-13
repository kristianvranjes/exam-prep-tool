from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.dashboard import CourseDashboard, ProgressSeries
from app.services import course_dashboard

router = APIRouter(prefix="/courses/{course_id}", tags=["dashboard"])

MAX_WEEKS = 26


@router.get("/dashboard", response_model=CourseDashboard)
def get_course_dashboard(
    course_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseDashboard:
    return course_dashboard.course_dashboard(db, user, course_id)


@router.get("/progress-series", response_model=ProgressSeries)
def get_progress_series(
    course_id: UUID,
    weeks: int = Query(8, ge=1, le=MAX_WEEKS),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProgressSeries:
    return course_dashboard.progress_series(db, user, course_id, weeks)
