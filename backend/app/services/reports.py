from datetime import UTC, datetime
from typing import cast
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Course, User
from app.models.question import Question
from app.models.question_report import QuestionReport
from app.schemas.question_report import (
    ModeratorReport,
    ReportCreate,
    ReportReceipt,
    ReportResolution,
    ReportStatus,
)
from app.services.courses import get_member_course
from app.services.moderation import require_moderator
from app.services.questions.service import load_question, owner_view


def receipt(report: QuestionReport) -> ReportReceipt:
    return ReportReceipt.model_validate(report, from_attributes=True)


def create_report(db: Session, user: User, question_id: UUID, data: ReportCreate) -> ReportReceipt:
    question, _ = load_question(db, user, question_id, mutate=True)
    get_member_course(db, user, question.course_id)
    if question.status != "APPROVED":
        raise HTTPException(409, "Only approved questions can be reported")
    report = QuestionReport(
        question_id=question.id,
        reported_by_user_id=user.id,
        reason=data.reason,
        details=data.details,
        status="OPEN",
    )
    try:
        db.add(report)
        db.flush()
        result = receipt(report)
        db.commit()
        return result
    except IntegrityError as exc:
        db.rollback()
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if constraint == "uq_question_report_open":
            raise HTTPException(409, "You already have an open report for this question") from None
        raise HTTPException(503, "Could not submit report") from None
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not submit report") from None


def report_queue(
    db: Session,
    user: User,
    faculty_id: UUID,
    course_id: UUID | None,
    status: ReportStatus,
    limit: int,
    offset: int,
) -> list[ModeratorReport]:
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
        select(QuestionReport, Question)
        .join(Question, Question.id == QuestionReport.question_id)
        .join(Course, Course.id == Question.course_id)
        .where(Course.faculty_id == faculty_id, QuestionReport.status == status)
    )
    if course_id is not None:
        query = query.where(Question.course_id == course_id)
    rows = db.execute(
        query.order_by(QuestionReport.created_at, QuestionReport.id).limit(limit).offset(offset)
    ).all()
    return [
        ModeratorReport(
            **receipt(report).model_dump(),
            resolution=cast(ReportResolution | None, report.resolution),
            resolved_by_user_id=report.resolved_by_user_id,
            resolved_at=report.resolved_at,
            question=owner_view(db, question),
        )
        for report, question in rows
    ]


def dismiss_report(db: Session, user: User, report_id: UUID) -> ModeratorReport:
    # Lock the question before the report, matching archive's lock order.
    question_id = db.scalar(
        select(QuestionReport.question_id).where(QuestionReport.id == report_id)
    )
    if question_id is None:
        raise HTTPException(404, "Report not found")
    question = db.scalar(select(Question).where(Question.id == question_id).with_for_update())
    if question is None:
        raise HTTPException(404, "Report not found")
    faculty_id = db.scalar(select(Course.faculty_id).where(Course.id == question.course_id))
    if faculty_id is None:
        raise HTTPException(404, "Report not found")
    require_moderator(db, user, faculty_id)
    report = db.scalar(
        select(QuestionReport)
        .where(QuestionReport.id == report_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if report is None:
        raise HTTPException(404, "Report not found")
    if report.status != "OPEN":
        raise HTTPException(409, "Report is already resolved")
    try:
        report.status = "RESOLVED"
        report.resolution = "DISMISSED"
        report.resolved_by_user_id = user.id
        report.resolved_at = datetime.now(UTC)
        db.flush()
        result = ModeratorReport(
            **receipt(report).model_dump(),
            resolution=cast(ReportResolution, report.resolution),
            resolved_by_user_id=report.resolved_by_user_id,
            resolved_at=report.resolved_at,
            question=owner_view(db, question),
        )
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not dismiss report") from None
