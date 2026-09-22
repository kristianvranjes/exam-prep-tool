from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Course, User
from app.models.question import Question
from app.schemas.question import OwnerQuestion, QuestionStatus
from app.services.moderation import require_moderator
from app.services.questions.service import owner_view


def review_queue(
    db: Session,
    user: User,
    faculty_id: UUID,
    course_id: UUID | None,
    status: QuestionStatus,
    limit: int,
    offset: int,
) -> list[OwnerQuestion]:
    require_moderator(db, user, faculty_id)
    if (
        course_id is not None
        and db.scalar(
            select(Course.id).where(Course.id == course_id, Course.faculty_id == faculty_id)
        )
        is None
    ):
        raise HTTPException(404, "Course not found")
    query = (
        select(Question)
        .join(Course)
        .where(Course.faculty_id == faculty_id, Question.status == status)
    )
    if course_id is not None:
        query = query.where(Question.course_id == course_id)
    return [
        owner_view(db, row)
        for row in db.scalars(
            query.order_by(Question.created_at, Question.id)
            .limit(limit)
            .offset(offset)
            .with_for_update(read=True, of=Question)
        )
    ]
