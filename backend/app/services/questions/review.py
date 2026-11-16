from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Course, User
from app.models.question import Question
from app.schemas.question import QuestionStatus
from app.schemas.unit_moderation import ReviewQuestion
from app.services.course_units import people
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
) -> list[ReviewQuestion]:
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
    rows = list(
        db.scalars(
            query.order_by(Question.created_at, Question.id)
            .limit(limit)
            .offset(offset)
            .with_for_update(read=True, of=Question)
        )
    )
    named = people(
        db, {id_ for row in rows for id_ in (row.created_by_user_id, row.reviewed_by_user_id)}
    )

    def name(id_: UUID | None) -> str | None:
        return named[id_].display_name if id_ in named else None

    return [
        ReviewQuestion.model_validate(
            owner_view(db, row).model_dump()
            | {
                "author_name": name(row.created_by_user_id),
                "reviewer_name": name(row.reviewed_by_user_id),
            }
        )
        for row in rows
    ]
