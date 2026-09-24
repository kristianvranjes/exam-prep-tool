from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Course, CourseMembership, MembershipRole, User
from app.models.faculty import Faculty
from app.models.material import Material
from app.schemas.course import CourseCreate, CourseUpdate
from app.services.faculties import active_faculty
from app.services.materials.storage import MaterialStorage
from app.services.moderation import require_moderator


def create_course(db: Session, user: User, data: CourseCreate) -> Course:
    active_faculty(db, data.faculty_id)
    require_moderator(db, user, data.faculty_id)
    course = Course(
        faculty_id=data.faculty_id,
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


def delete_course(db: Session, user: User, course_id: UUID, storage: MaterialStorage) -> None:
    get_owner_course(db, user, course_id)
    try:
        # Serialize deletes and keep new child rows from appearing during cleanup.
        course = db.scalar(
            select(Course)
            .where(Course.id == course_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not delete course") from None
    if course is None:
        db.rollback()
        raise HTTPException(404, "Course not found")
    try:
        materials = db.scalars(
            select(Material)
            .where(Material.course_id == course_id)
            .order_by(Material.id)
            .with_for_update()
        )
        keys = [material.storage_key for material in materials]
        for key in keys:
            storage.delete(key)
        db.delete(course)
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not delete course") from None


def join_course(db: Session, user: User, course_id: UUID) -> CourseMembership:
    try:
        # Shared locks keep catalog availability stable until enrollment commits.
        course = db.scalar(
            select(Course)
            .join(Faculty)
            .where(Course.id == course_id, Course.is_active.is_(True), Faculty.is_active.is_(True))
            .with_for_update(read=True, of=(Faculty, Course))
        )
        if course is None:
            raise HTTPException(404, "Course not found")
        db.execute(
            insert(CourseMembership)
            .values(course_id=course_id, user_id=user.id, role=MembershipRole.MEMBER.value)
            .on_conflict_do_nothing(constraint="uq_course_membership_course_user")
        )
        membership = db.scalar(
            select(CourseMembership).where(
                CourseMembership.course_id == course_id, CourseMembership.user_id == user.id
            )
        )
        assert membership is not None
        db.commit()
        return membership
    except Exception:
        db.rollback()
        raise
