from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.quiz import AnswerPayload, AttemptResponse, AttemptSummary, StartQuiz
from app.services import quizzes

router = APIRouter(prefix="/courses/{course_id}/attempts", tags=["practice"])


@router.post("", response_model=AttemptResponse, status_code=201)
def start(
    course_id: UUID,
    data: StartQuiz,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AttemptResponse:
    return quizzes.start(db, user, course_id, data)


@router.get("", response_model=list[AttemptSummary])
def history(
    course_id: UUID,
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AttemptSummary]:
    return quizzes.list_attempts(db, user, course_id, limit, offset)


@router.get("/{attempt_id}", response_model=AttemptResponse)
def read(
    course_id: UUID,
    attempt_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AttemptResponse:
    attempt = quizzes.load_attempt(db, user, course_id, attempt_id)
    return quizzes.representation(db, attempt, course_id)


@router.patch("/{attempt_id}/answers/{question_id}", response_model=AttemptResponse)
def answer(
    course_id: UUID,
    attempt_id: UUID,
    question_id: UUID,
    data: AnswerPayload,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AttemptResponse:
    return quizzes.save_answer(db, user, course_id, attempt_id, question_id, data)


@router.post("/{attempt_id}/submit", response_model=AttemptResponse)
def submit(
    course_id: UUID,
    attempt_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AttemptResponse:
    return quizzes.submit(db, user, course_id, attempt_id)


@router.post("/{attempt_id}/abandon", response_model=AttemptResponse)
def abandon(
    course_id: UUID,
    attempt_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AttemptResponse:
    return quizzes.abandon(db, user, course_id, attempt_id)
