from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.favorite import FavoriteQuestion, FavoriteState
from app.services import favorites

router = APIRouter(prefix="/courses/{course_id}/favorites", tags=["practice"])


@router.get("", response_model=list[FavoriteQuestion])
def list_favorites(
    course_id: UUID,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[FavoriteQuestion]:
    return favorites.list_favorites(db, user, course_id, limit, offset)


# POST and DELETE are both idempotent; the CORS policy allows no PUT.
@router.post("/{question_id}", response_model=FavoriteState)
def add(
    course_id: UUID,
    question_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FavoriteState:
    return favorites.favorite(db, user, course_id, question_id)


@router.delete("/{question_id}", response_model=FavoriteState)
def remove(
    course_id: UUID,
    question_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FavoriteState:
    return favorites.unfavorite(db, user, course_id, question_id)
