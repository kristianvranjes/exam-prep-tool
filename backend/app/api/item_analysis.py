from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.item_analysis import ItemAnalysis, ItemAnalysisList
from app.services import item_analysis as service

router = APIRouter(prefix="/courses/{course_id}/item-analysis", tags=["item analysis"])


@router.get("", response_model=ItemAnalysisList)
def list_analysis(
    course_id: UUID,
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ItemAnalysisList:
    return service.list_analysis(db, user, course_id, limit, offset)


@router.get("/{question_id}", response_model=ItemAnalysis)
def question_analysis(
    course_id: UUID,
    question_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ItemAnalysis:
    return service.question_analysis(db, user, course_id, question_id)
