from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Course, CourseMembership, MembershipRole, User
from app.schemas.course import CourseCreate, CourseUpdate


def create_course(db: Session, user: User, data: CourseCreate) -> Course:
    course = Course(
        name=data.name.strip(),
        code=data.code.strip() if data.code else None,
        description=data.description.strip() if data.description else None,
        created_by_user_id=user.id,
    )
    db.add(course)
    db.flush()
    db.add(CourseMembership(course_id=course.id, user_id=user.id, role=MembershipRole.OWNER.value))
    db.commit()
    db.refresh(course)
    return course


def get_member_course(db: Session, user: User, course_id: UUID) -> Course:
    query = (
        select(Course)
        .join(CourseMembership)
        .where(Course.id == course_id, CourseMembership.user_id == user.id)
    )
    course = db.scalar(query)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


def list_member_courses(db: Session, user: User) -> list[Course]:
    return list(
        db.scalars(
            select(Course).join(CourseMembership).where(CourseMembership.user_id == user.id)
        ).all()
    )


def get_owner_course(db: Session, user: User, course_id: UUID) -> Course:
    course = get_member_course(db, user, course_id)
    membership = db.scalar(
        select(CourseMembership).where(
            CourseMembership.course_id == course_id, CourseMembership.user_id == user.id
        )
    )
    if membership is None or membership.role != MembershipRole.OWNER.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner access required")
    return course


def update_course(db: Session, user: User, course_id: UUID, data: CourseUpdate) -> Course:
    course = get_owner_course(db, user, course_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(course, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    db.refresh(course)
    return course


def delete_course(db: Session, user: User, course_id: UUID) -> None:
    course = get_owner_course(db, user, course_id)
    db.delete(course)
    db.commit()
