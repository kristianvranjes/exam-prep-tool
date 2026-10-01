from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.question import RejectRequest
from app.schemas.question_edit_suggestion import (
    ModeratorSuggestion,
    SuggestionCreate,
    SuggestionReceipt,
)
from app.services.suggestions import create_suggestion, decide_suggestion

router = APIRouter(tags=["question edit suggestions"])


@router.post(
    "/questions/{question_id}/suggestions", response_model=SuggestionReceipt, status_code=201
)
def create(
    question_id: UUID,
    data: SuggestionCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SuggestionReceipt:
    return create_suggestion(db, user, question_id, data)


@router.post("/question-suggestions/{suggestion_id}/approve", response_model=ModeratorSuggestion)
def approve(
    suggestion_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ModeratorSuggestion:
    return decide_suggestion(db, user, suggestion_id, approve=True)


@router.post("/question-suggestions/{suggestion_id}/reject", response_model=ModeratorSuggestion)
def reject(
    suggestion_id: UUID,
    data: RejectRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ModeratorSuggestion:
    return decide_suggestion(db, user, suggestion_id, approve=False, reason=data.reason)
