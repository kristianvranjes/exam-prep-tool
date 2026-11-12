from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.preferences import PreferencesBody, PreferencesResponse
from app.services.preferences import get_preferences, save_preferences

router = APIRouter(prefix="/auth/me/preferences", tags=["preferences"])


@router.get("", response_model=PreferencesResponse)
def read(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> PreferencesResponse:
    return get_preferences(db, user)


@router.put("", response_model=PreferencesResponse)
def replace(
    body: PreferencesBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> PreferencesResponse:
    return save_preferences(db, user, body)
