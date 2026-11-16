from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from app.models import Course, CourseMembership, MembershipRole, User
from app.models.faculty import Faculty
from app.models.material import Material
from app.schemas.course import (
    CourseCreate,
    CourseUpdate,
    MembershipStatus,
)
from app.services.faculties import active_faculty
from app.services.materials.cleanup import cleanup_sources, queue_sources
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
        year_of_study=data.year_of_study,
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


def set_membership_status(
    db: Session, user: User, course_id: UUID, membership_status: MembershipStatus
) -> CourseMembership:
    membership = db.scalar(
        select(CourseMembership)
        .where(CourseMembership.course_id == course_id, CourseMembership.user_id == user.id)
        .with_for_update()
    )
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")
    membership.status = membership_status
    db.commit()
    db.refresh(membership)
    return membership


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
    changes = data.model_dump(exclude_unset=True)
    if not changes or set(changes) - {"year_of_study"}:
        course = get_owner_course(db, user, course_id)
    else:
        # The year is set by a faculty moderator, who need not own or even join the course.
        found = db.get(Course, course_id)
        if found is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
        course = found
    if "year_of_study" in changes:
        require_moderator(db, user, course.faculty_id)
    for field, value in changes.items():
        setattr(course, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    db.refresh(course)
    return course


def delete_course(db: Session, user: User, course_id: UUID, storage: MaterialStorage) -> None:
    try:
        get_owner_course(db, user, course_id)
        # Serialize deletes and keep new child rows from appearing during cleanup.
        course = db.scalar(
            select(Course)
            .where(Course.id == course_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if course is None:
            raise HTTPException(404, "Course not found")
        materials = db.scalars(
            select(Material)
            .where(Material.course_id == course_id)
            .order_by(Material.id)
            .with_for_update()
        )
        keys = [material.storage_key for material in materials]
        cleanup_ids = queue_sources(db, keys)
        db.delete(course)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not delete course") from None

    cleanup_sources(sessionmaker(bind=db.get_bind()), storage, cleanup_ids=cleanup_ids)


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
        # Enrolling again brings a hidden course back; an active or finished one is left as is.
        db.execute(
            insert(CourseMembership)
            .values(course_id=course_id, user_id=user.id, role=MembershipRole.MEMBER.value)
            .on_conflict_do_update(
                constraint="uq_course_membership_course_user",
                set_={"status": "ACTIVE"},
                where=CourseMembership.status == "HIDDEN",
            )
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
