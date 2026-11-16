from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.preferences import Preferences
from app.services.preferences import get_preferences, save_preferences

router = APIRouter(prefix="/users/me/preferences", tags=["preferences"])


@router.get("", response_model=Preferences)
def read(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Preferences:
    return get_preferences(db, user)


@router.put("", response_model=Preferences)
def replace(
    data: Preferences, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Preferences:
    return save_preferences(db, user, data)
