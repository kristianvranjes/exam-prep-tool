from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.models.faculty import Faculty
from app.schemas.question import OwnerQuestion, QuestionStatus
from app.schemas.question_edit_suggestion import ModeratorSuggestion, SuggestionStatus
from app.schemas.question_report import ModeratorReport, ReportStatus
from app.services.moderation import is_moderator
from app.services.questions.review import review_queue
from app.services.reports import report_queue
from app.services.suggestions import suggestion_queue

router = APIRouter(prefix="/faculties/{faculty_id}", tags=["moderation"])


@router.get("/moderator-status")
def moderator_status(
    faculty_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict[str, bool]:
    if db.get(Faculty, faculty_id) is None:
        raise HTTPException(404, "Faculty not found")
    return {"is_moderator": is_moderator(db, user.id, faculty_id)}


@router.get("/question-review", response_model=list[OwnerQuestion])
def question_review(
    faculty_id: UUID,
    course_id: UUID | None = None,
    status: QuestionStatus = "PENDING_REVIEW",
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[OwnerQuestion]:
    return review_queue(db, user, faculty_id, course_id, status, limit, offset)


@router.get("/question-reports", response_model=list[ModeratorReport])
def question_reports(
    faculty_id: UUID,
    course_id: UUID | None = None,
    status: ReportStatus = "OPEN",
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ModeratorReport]:
    return report_queue(db, user, faculty_id, course_id, status, limit, offset)


@router.get("/question-suggestions", response_model=list[ModeratorSuggestion])
def question_suggestions(
    faculty_id: UUID,
    course_id: UUID | None = None,
    status: SuggestionStatus = "OPEN",
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ModeratorSuggestion]:
    return suggestion_queue(db, user, faculty_id, course_id, status, limit, offset)
