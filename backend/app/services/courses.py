from datetime import UTC, datetime
from typing import cast
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import exists, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from app.models import Course, CourseMembership, MembershipRole, User
from app.models.exam_scope import ExamScope
from app.models.faculty import Faculty
from app.models.faculty_moderator import FacultyModerator
from app.models.material import Material
from app.models.question import Question
from app.schemas.course import (
    EXAM_KINDS,
    CatalogCourseResponse,
    CourseCreate,
    CourseResponse,
    CourseUpdate,
    MemberCourseResponse,
    MembershipStatus,
    NextExam,
)
from app.services.faculties import active_faculty, list_faculty_courses
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


def approved_question_counts(db: Session, course_ids: list[UUID]) -> dict[UUID, int]:
    """Questions students can practise, per course; courses without any are absent."""
    if not course_ids:
        return {}
    rows = db.execute(
        select(Question.course_id, func.count())
        .where(Question.course_id.in_(course_ids), Question.status == "APPROVED")
        .group_by(Question.course_id)
    )
    return {course_id: count for course_id, count in rows}


def next_exams(db: Session, course_ids: list[UUID]) -> dict[UUID, NextExam]:
    """The nearest dated exam per course whose last day is today or later (UTC date)."""
    if not course_ids:
        return {}
    last_day = func.coalesce(ExamScope.ends_on, ExamScope.starts_on)
    scopes = db.scalars(
        select(ExamScope)
        .where(
            ExamScope.course_id.in_(course_ids),
            ExamScope.kind.in_(EXAM_KINDS),
            ExamScope.starts_on.is_not(None),
            last_day >= datetime.now(UTC).date(),
        )
        .order_by(ExamScope.course_id, ExamScope.starts_on, ExamScope.id)
    )
    nearest: dict[UUID, NextExam] = {}
    for scope in scopes:
        if scope.course_id not in nearest and scope.starts_on is not None:
            nearest[scope.course_id] = NextExam(
                scope_id=scope.id,
                kind=scope.kind,  # type: ignore[arg-type]  # narrowed by the EXAM_KINDS filter
                name=scope.name,
                starts_on=scope.starts_on,
                ends_on=scope.ends_on,
            )
    return nearest


def list_member_courses(db: Session, user: User) -> list[MemberCourseResponse]:
    rows = db.execute(
        select(Course, CourseMembership.status)
        .join(CourseMembership)
        .where(CourseMembership.user_id == user.id)
    ).all()
    course_ids = [course.id for course, _ in rows]
    counts = approved_question_counts(db, course_ids)
    exams = next_exams(db, course_ids)
    return [
        MemberCourseResponse(
            **CourseResponse.model_validate(course).model_dump(),
            membership_status=cast(
                MembershipStatus, membership_status
            ),  # the column is constrained
            approved_question_count=counts.get(course.id, 0),
            next_exam=exams.get(course.id),
        )
        for course, membership_status in rows
    ]


def list_catalog_courses(
    db: Session, faculty_id: UUID, limit: int, offset: int
) -> list[CatalogCourseResponse]:
    courses = list_faculty_courses(db, faculty_id, limit, offset)
    counts = approved_question_counts(db, [course.id for course in courses])
    has_moderators = bool(
        db.scalar(select(exists().where(FacultyModerator.faculty_id == faculty_id)))
    )
    return [
        CatalogCourseResponse(
            **CourseResponse.model_validate(course).model_dump(),
            approved_question_count=counts.get(course.id, 0),
            has_moderators=has_moderators,
        )
        for course in courses
    ]


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
