from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import Course, CourseMembership, User
from app.schemas.course import CourseCreate, CourseResponse, CourseUpdate, MembershipResponse
from app.services.courses import (
    create_course,
    delete_course,
    get_member_course,
    join_course,
    list_member_courses,
    update_course,
)

router = APIRouter(prefix="/courses", tags=["courses"])


@router.post("", response_model=CourseResponse, status_code=status.HTTP_201_CREATED)
def create(
    data: CourseCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Course:
    return create_course(db, user, data)


@router.get("", response_model=list[CourseResponse])
def list_courses(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[Course]:
    return list_member_courses(db, user)


@router.get("/{course_id}", response_model=CourseResponse)
def get_course(
    course_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Course:
    return get_member_course(db, user, course_id)


@router.get("/{course_id}/membership", response_model=MembershipResponse)
def membership(
    course_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> CourseMembership:
    get_member_course(db, user, course_id)
    result = db.scalar(
        select(CourseMembership).where(
            CourseMembership.course_id == course_id, CourseMembership.user_id == user.id
        )
    )
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")
    return result


@router.patch("/{course_id}", response_model=CourseResponse)
def update(
    course_id: UUID,
    data: CourseUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Course:
    return update_course(db, user, course_id, data)


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove(
    course_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    delete_course(db, user, course_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{course_id}/join", response_model=MembershipResponse)
def join(
    course_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> CourseMembership:
    return join_course(db, user, course_id)
