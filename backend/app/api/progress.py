from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from uuid import UUID

from app.database import get_db
from app.models.user_question_progress import UserQuestionProgress
from app.schemas.progress import ProgressResponse
from app.services.scheduling import SchedulingService

router = APIRouter(prefix="/courses/{course_id}/progress", tags=["progress"])


@router.get("/", response_model=list[ProgressResponse])
def get_course_progress(
    course_id: UUID,
    user_id: UUID,
    db: Session = Depends(get_db),
):
    """
    Get the review progress for all questions in a course for the current user.

    Args:
        course_id: The ID of the course.
        user_id: The ID of the user.
        db: The database session.

    Returns:
        A list of ProgressResponse objects.
    """
    scheduling_service = SchedulingService(db)
    progress_records = db.query(UserQuestionProgress).filter(
        UserQuestionProgress.user_id == user_id,
        UserQuestionProgress.source_question_id.in_(
            db.query(Question.id).filter(Question.course_id == course_id)
        )
    ).all()

    return [
        ProgressResponse(
            source_question_id=record.source_question_id,
            stage=record.stage,
            due_at=record.due_at,
            last_attempted_at=record.last_attempted_at,
        )
        for record in progress_records
    ]