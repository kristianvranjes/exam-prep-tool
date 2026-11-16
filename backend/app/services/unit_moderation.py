from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Course, User
from app.models.course_unit import CourseUnit, QuestionUnit
from app.models.question import Question
from app.models.question_edit_suggestion import QuestionEditSuggestion
from app.models.question_report import QuestionReport
from app.schemas.course_unit import CourseUnitResponse, UnitStatus
from app.schemas.unit_moderation import (
    ModerationCounts,
    UnitModerationDetail,
    UnitModerationRow,
    UnitQuestionRow,
)
from app.services.course_units import (
    course_units,
    is_course_owner,
    lock_course,
    people,
    responses,
)
from app.services.courses import get_member_course
from app.services.moderation import course_moderator, require_moderator


def pairs(result: Iterable[Any]) -> dict[UUID, int]:
    """Rows of (id, count) as a mapping."""
    return {row[0]: row[1] for row in result}


def access(db: Session, user: User, course_id: UUID) -> tuple[bool, bool]:
    """(is course owner, is faculty moderator); a moderator need not have joined the course."""
    if db.get(Course, course_id) is None:
        raise HTTPException(404, "Course not found")
    owner = is_course_owner(db, user, course_id)
    moderator = course_moderator(db, user, course_id)
    if not owner and not moderator:
        get_member_course(db, user, course_id)  # 404 for people who cannot see the course
        raise HTTPException(403, "Course owner or faculty moderator access required")
    return owner, moderator


def moderation_rows(
    db: Session, course_id: UUID, base: list[CourseUnitResponse]
) -> list[UnitModerationRow]:
    """Counters per unit over its questions that are not archived."""
    unit_ids = [row.id for row in base]
    stats: dict[UUID, tuple[Any, ...]] = {
        row[0]: tuple(row[1:])
        for row in db.execute(
            select(
                QuestionUnit.unit_id,
                func.count(),
                func.count().filter(Question.status == "DRAFT"),
                func.count().filter(Question.status == "REJECTED"),
                func.count().filter(Question.status == "PENDING_REVIEW"),
                func.count().filter(Question.explanation.is_(None)),
                func.max(Question.updated_at),
            )
            .join(Question, Question.id == QuestionUnit.question_id)
            .where(
                QuestionUnit.unit_id.in_(unit_ids),
                Question.course_id == course_id,
                Question.status != "ARCHIVED",
            )
            .group_by(QuestionUnit.unit_id)
        )
    }
    reports = pairs(
        db.execute(
            select(QuestionUnit.unit_id, func.count())
            .join(QuestionReport, QuestionReport.question_id == QuestionUnit.question_id)
            .join(Question, Question.id == QuestionUnit.question_id)
            .where(
                QuestionUnit.unit_id.in_(unit_ids),
                QuestionReport.status == "OPEN",
                Question.status != "ARCHIVED",
            )
            .group_by(QuestionUnit.unit_id)
        )
    )
    suggestions = pairs(
        db.execute(
            select(QuestionUnit.unit_id, func.count())
            .join(
                QuestionEditSuggestion,
                QuestionEditSuggestion.question_id == QuestionUnit.question_id,
            )
            .join(Question, Question.id == QuestionUnit.question_id)
            .where(
                QuestionUnit.unit_id.in_(unit_ids),
                QuestionEditSuggestion.status == "OPEN",
                Question.status != "ARCHIVED",
            )
            .group_by(QuestionUnit.unit_id)
        )
    )
    result = []
    for unit in base:
        total, draft, rejected, pending, bare, latest = stats.get(
            unit.id, (0, 0, 0, 0, 0, unit.updated_at)
        )
        result.append(
            UnitModerationRow.model_validate(
                unit.model_dump()
                | {
                    "question_count": total,
                    "draft_count": draft,
                    "rejected_count": rejected,
                    "pending_review_count": pending,
                    "without_explanation_count": bare,
                    "open_report_count": reports.get(unit.id, 0),
                    "open_suggestion_count": suggestions.get(unit.id, 0),
                    "last_changed_at": max(unit.updated_at, latest),
                }
            )
        )
    return result


def list_units(db: Session, user: User, course_id: UUID) -> list[UnitModerationRow]:
    access(db, user, course_id)
    units = course_units(db, course_id, include_archived=False)
    return moderation_rows(db, course_id, responses(db, course_id, units))


def unit_detail(
    db: Session, user: User, unit_id: UUID, limit: int, offset: int
) -> UnitModerationDetail:
    unit = db.get(CourseUnit, unit_id)
    if unit is None:
        raise HTTPException(404, "Unit not found")
    access(db, user, unit.course_id)
    row = moderation_rows(db, unit.course_id, responses(db, unit.course_id, [unit]))[0]
    questions = list(
        db.scalars(
            select(Question)
            .join(QuestionUnit, QuestionUnit.question_id == Question.id)
            .where(QuestionUnit.unit_id == unit_id, Question.status != "ARCHIVED")
            .order_by(Question.created_at, Question.id)
            .limit(limit)
            .offset(offset)
        )
    )
    ids = [question.id for question in questions]
    reports = pairs(
        db.execute(
            select(QuestionReport.question_id, func.count())
            .where(QuestionReport.question_id.in_(ids), QuestionReport.status == "OPEN")
            .group_by(QuestionReport.question_id)
        )
    )
    suggestions = pairs(
        db.execute(
            select(QuestionEditSuggestion.question_id, func.count())
            .where(
                QuestionEditSuggestion.question_id.in_(ids), QuestionEditSuggestion.status == "OPEN"
            )
            .group_by(QuestionEditSuggestion.question_id)
        )
    )
    named = people(db, {question.created_by_user_id for question in questions})
    return UnitModerationDetail(
        unit=row,
        questions=[
            UnitQuestionRow(
                id=question.id,
                type=question.type,  # type: ignore[arg-type]
                status=question.status,  # type: ignore[arg-type]
                source=question.source,
                stem=question.stem,
                difficulty=question.difficulty,
                has_explanation=question.explanation is not None,
                author=named.get(question.created_by_user_id),
                open_report_count=reports.get(question.id, 0),
                open_suggestion_count=suggestions.get(question.id, 0),
                updated_at=question.updated_at,
            )
            for question in questions
        ],
    )


def set_status(db: Session, user: User, unit_id: UUID, status: UnitStatus) -> CourseUnitResponse:
    """Move a unit through draft -> under review -> published.

    The course owner sends a draft for review; a faculty moderator publishes it (a moderator who
    owns the course may publish their own draft) or takes a unit back to draft. Archived units
    keep their status.
    """
    course_id = db.scalar(select(CourseUnit.course_id).where(CourseUnit.id == unit_id))
    if course_id is None:
        raise HTTPException(404, "Unit not found")
    owner, moderator = access(db, user, course_id)
    lock_course(db, course_id)
    unit = db.scalar(
        select(CourseUnit)
        .where(CourseUnit.id == unit_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if unit is None:
        db.rollback()
        raise HTTPException(404, "Unit not found")
    old = unit.status
    if status == "PENDING_REVIEW":
        allowed, needs = old == "DRAFT", owner
    elif status == "PUBLISHED":
        allowed = old == "PENDING_REVIEW" or (old == "DRAFT" and owner)
        needs = moderator
    else:
        allowed, needs = old != "DRAFT", owner or moderator
    if not needs or unit.is_archived or not allowed:
        db.rollback()
        if not needs:
            raise HTTPException(403, "You may not make this change to the unit")
        raise HTTPException(409, "Invalid unit status change")
    unit.status = status
    unit.reviewer_id = user.id if status == "PUBLISHED" else None
    unit.reviewed_at = datetime.now(UTC) if status == "PUBLISHED" else None
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not save unit status") from None
    db.refresh(unit)
    return responses(db, course_id, [unit])[0]


def moderation_counts(
    db: Session, user: User, faculty_id: UUID, course_id: UUID | None
) -> ModerationCounts:
    """What waits for a moderator of the faculty, optionally within one course."""
    require_moderator(db, user, faculty_id)
    if (
        course_id is not None
        and db.scalar(
            select(Course.id).where(Course.id == course_id, Course.faculty_id == faculty_id)
        )
        is None
    ):
        raise HTTPException(404, "Course not found")

    questions = (
        select(func.count())
        .select_from(Question)
        .join(Course, Course.id == Question.course_id)
        .where(Course.faculty_id == faculty_id, Question.status == "PENDING_REVIEW")
    )
    units = (
        select(func.count())
        .select_from(CourseUnit)
        .join(Course, Course.id == CourseUnit.course_id)
        .where(
            Course.faculty_id == faculty_id,
            CourseUnit.status == "PENDING_REVIEW",
            CourseUnit.is_archived.is_(False),
        )
    )
    reports = (
        select(func.count())
        .select_from(QuestionReport)
        .join(Question, Question.id == QuestionReport.question_id)
        .join(Course, Course.id == Question.course_id)
        .where(Course.faculty_id == faculty_id, QuestionReport.status == "OPEN")
    )
    suggestions = (
        select(func.count())
        .select_from(QuestionEditSuggestion)
        .join(Question, Question.id == QuestionEditSuggestion.question_id)
        .join(Course, Course.id == Question.course_id)
        .where(Course.faculty_id == faculty_id, QuestionEditSuggestion.status == "OPEN")
    )
    if course_id is not None:
        questions = questions.where(Question.course_id == course_id)
        units = units.where(CourseUnit.course_id == course_id)
        reports = reports.where(Question.course_id == course_id)
        suggestions = suggestions.where(Question.course_id == course_id)
    return ModerationCounts(
        pending_questions=db.scalar(questions) or 0,
        open_reports=db.scalar(reports) or 0,
        open_suggestions=db.scalar(suggestions) or 0,
        pending_units=db.scalar(units) or 0,
    )
