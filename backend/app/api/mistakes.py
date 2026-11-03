from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.mistake import MistakeQuery, MistakeQuestion
from app.services import mistakes

router = APIRouter(prefix="/courses/{course_id}/mistakes", tags=["practice"])


@router.get("", response_model=list[MistakeQuestion])
def list_mistakes(
    course_id: UUID,
    query: Annotated[MistakeQuery, Query()],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[MistakeQuestion]:
    return mistakes.list_mistakes(db, user, course_id, query)
