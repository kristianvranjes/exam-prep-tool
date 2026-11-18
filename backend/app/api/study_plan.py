from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.study_plan import PlanSettings, PlanSettingsUpdate, StudyPlanResponse
from app.services import study_plan as service

router = APIRouter(tags=["study plan"])


@router.get("/courses/{course_id}/study-plan", response_model=StudyPlanResponse)
def read(
    course_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> StudyPlanResponse:
    """The caller's plan settings for the course and, when switched on, the plan (#173)."""
    return service.study_plan(db, user, course_id)


@router.put("/courses/{course_id}/study-plan", response_model=PlanSettings)
def update(
    course_id: UUID,
    data: PlanSettingsUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanSettings:
    return service.update_settings(db, user, course_id, data)
