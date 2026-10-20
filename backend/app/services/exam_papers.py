"""Past exam papers: managed by course owners and faculty moderators, read by members."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import cast
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import case, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Course, CourseMembership, User
from app.models.exam_paper import ExamPaper, ExamPaperItem
from app.models.exam_scope import ExamScope
from app.models.question import Question
from app.schemas.exam_paper import (
    MAX_COURSE_PAPERS,
    ExamPaperCreate,
    ExamPaperDetail,
    ExamPaperItems,
    ExamPaperList,
    ExamPaperSummary,
    ExamPaperUpdate,
    PaperItemManager,
    PaperItemPublic,
    PaperStatus,
)
from app.schemas.exam_scope import ExamScopeKind
from app.schemas.question import QuestionStatus, QuestionType, normalize
from app.services.course_units import is_course_owner, lock_course
from app.services.moderation import course_moderator

KIND_ORDER = case(
    (ExamPaper.kind == "MIDTERM", 0),
    (ExamPaper.kind == "FINAL", 1),
    (ExamPaper.kind == "FULL_EXAM", 2),
    (ExamPaper.kind == "LAB", 3),
    else_=4,
)
DUPLICATE = "An exam paper with this title already exists in that academic year"


def course_access(db: Session, user: User, course_id: UUID) -> bool:
    """Return whether the caller manages the course's papers; 404 without any access.

    Faculty moderators manage without enrolling, like the moderation queues.
    """
    if db.get(Course, course_id) is None:
        raise HTTPException(404, "Course not found")
    if course_moderator(db, user, course_id):
        return True
    member = db.scalar(
        select(CourseMembership.role).where(
            CourseMembership.course_id == course_id, CourseMembership.user_id == user.id
        )
    )
    if member is None:
        raise HTTPException(404, "Course not found")
    return is_course_owner(db, user, course_id)


def require_manager(db: Session, user: User, course_id: UUID) -> None:
    if not course_access(db, user, course_id):
        raise HTTPException(403, "Course owner or faculty moderator access required")


def totals(db: Session, paper_ids: list[UUID]) -> dict[UUID, tuple[int, Decimal]]:
    return {
        paper_id: (count, points)
        for paper_id, count, points in db.execute(
            select(
                ExamPaperItem.paper_id,
                func.count(ExamPaperItem.id),
                func.coalesce(func.sum(ExamPaperItem.points), 0),
            )
            .where(ExamPaperItem.paper_id.in_(paper_ids))
            .group_by(ExamPaperItem.paper_id)
        ).tuples()
    }


def summaries(db: Session, papers: list[ExamPaper]) -> list[ExamPaperSummary]:
    counts = totals(db, [paper.id for paper in papers])
    return [summary(paper, *counts.get(paper.id, (0, Decimal(0)))) for paper in papers]


def summary(paper: ExamPaper, item_count: int, total_points: Decimal) -> ExamPaperSummary:
    return ExamPaperSummary(
        id=paper.id,
        course_id=paper.course_id,
        academic_year=paper.academic_year,
        kind=cast(ExamScopeKind, paper.kind),
        title=paper.title,
        term_label=paper.term_label,
        exam_date=paper.exam_date,
        exam_scope_id=paper.exam_scope_id,
        duration_minutes=paper.duration_minutes,
        wrong_answer_penalty=float(paper.wrong_answer_penalty),
        pass_threshold=None if paper.pass_threshold is None else float(paper.pass_threshold),
        status=cast(PaperStatus, paper.status),
        published_at=paper.published_at,
        item_count=item_count,
        total_points=float(total_points),
        created_at=paper.created_at,
        updated_at=paper.updated_at,
    )


def list_papers(
    db: Session,
    user: User,
    course_id: UUID,
    academic_year: str | None,
    kind: ExamScopeKind | None,
    limit: int,
    offset: int,
) -> ExamPaperList:
    manage = course_access(db, user, course_id)
    query = select(ExamPaper).where(ExamPaper.course_id == course_id)
    if not manage:
        query = query.where(ExamPaper.status == "PUBLISHED")
    if academic_year:
        query = query.where(ExamPaper.academic_year == academic_year)
    if kind:
        query = query.where(ExamPaper.kind == kind)
    papers = list(
        db.scalars(
            query.order_by(
                ExamPaper.academic_year.desc(),
                ExamPaper.exam_date.desc().nulls_last(),
                KIND_ORDER,
                ExamPaper.normalized_title,
                ExamPaper.id,
            )
            .limit(limit)
            .offset(offset)
        )
    )
    return ExamPaperList(can_manage=manage, papers=summaries(db, papers))


def detail(db: Session, paper: ExamPaper, manage: bool) -> ExamPaperDetail:
    rows = db.execute(
        select(ExamPaperItem, Question.type, Question.stem, Question.status)
        .join(Question, Question.id == ExamPaperItem.question_id)
        .where(ExamPaperItem.paper_id == paper.id)
        .order_by(ExamPaperItem.position)
    ).tuples()
    items: list[PaperItemPublic | PaperItemManager] = []
    total = Decimal(0)
    for item, type_, stem, status in rows:
        total += item.points
        public = PaperItemPublic(
            position=item.position,
            label=item.label,
            points=float(item.points),
            type=cast(QuestionType, type_),
        )
        items.append(
            PaperItemManager(
                **public.model_dump(),
                question_id=item.question_id,
                stem=stem,
                question_status=cast(QuestionStatus, status),
            )
            if manage
            else public
        )
    return ExamPaperDetail(
        **summary(paper, len(items), total).model_dump(), can_manage=manage, items=items
    )


def load_paper(
    db: Session, user: User, paper_id: UUID, mutate: bool = False
) -> tuple[ExamPaper, bool]:
    course_id = db.scalar(select(ExamPaper.course_id).where(ExamPaper.id == paper_id))
    if course_id is None:
        raise HTTPException(404, "Exam paper not found")
    manage = course_access(db, user, course_id)
    if mutate:
        if not manage:
            raise HTTPException(403, "Course owner or faculty moderator access required")
        lock_course(db, course_id)
    query = select(ExamPaper).where(ExamPaper.id == paper_id)
    if mutate:
        query = query.with_for_update().execution_options(populate_existing=True)
    paper = db.scalar(query)
    # Unpublished papers do not exist for members.
    if paper is None or (not manage and paper.status != "PUBLISHED"):
        raise HTTPException(404, "Exam paper not found")
    return paper, manage


def read_paper(db: Session, user: User, paper_id: UUID) -> ExamPaperDetail:
    paper, manage = load_paper(db, user, paper_id)
    return detail(db, paper, manage)


def check_scope(db: Session, course_id: UUID, scope_id: UUID | None) -> None:
    if scope_id is None:
        return
    found = db.scalar(
        select(ExamScope.id).where(ExamScope.id == scope_id, ExamScope.course_id == course_id)
    )
    if found is None:
        raise HTTPException(422, "Choose an exam cycle from this course")


def commit_detail(db: Session, paper: ExamPaper) -> ExamPaperDetail:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, DUPLICATE) from None
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not save exam paper") from None
    db.refresh(paper)
    return detail(db, paper, True)


def create_paper(
    db: Session, user: User, course_id: UUID, data: ExamPaperCreate
) -> ExamPaperDetail:
    require_manager(db, user, course_id)
    lock_course(db, course_id)
    try:
        count = db.scalar(
            select(func.count()).select_from(ExamPaper).where(ExamPaper.course_id == course_id)
        )
        if (count or 0) >= MAX_COURSE_PAPERS:
            raise HTTPException(409, f"A course can have at most {MAX_COURSE_PAPERS} exam papers")
        check_scope(db, course_id, data.exam_scope_id)
    except HTTPException:
        db.rollback()
        raise
    paper = ExamPaper(
        course_id=course_id,
        academic_year=data.academic_year,
        kind=data.kind,
        title=data.title,
        normalized_title=normalize(data.title),
        term_label=data.term_label,
        exam_date=data.exam_date,
        exam_scope_id=data.exam_scope_id,
        duration_minutes=data.duration_minutes,
        wrong_answer_penalty=Decimal(str(data.wrong_answer_penalty)),
        pass_threshold=None if data.pass_threshold is None else Decimal(str(data.pass_threshold)),
        created_by_user_id=user.id,
    )
    db.add(paper)
    return commit_detail(db, paper)


def update_paper(db: Session, user: User, paper_id: UUID, data: ExamPaperUpdate) -> ExamPaperDetail:
    paper, _ = load_paper(db, user, paper_id, mutate=True)
    fields = data.model_fields_set
    try:
        if "exam_scope_id" in fields:
            check_scope(db, paper.course_id, data.exam_scope_id)
    except HTTPException:
        db.rollback()
        raise
    if data.academic_year is not None:
        paper.academic_year = data.academic_year
    if data.kind is not None:
        paper.kind = data.kind
    if data.title is not None:
        paper.title = data.title
        paper.normalized_title = normalize(data.title)
    if data.wrong_answer_penalty is not None:
        paper.wrong_answer_penalty = Decimal(str(data.wrong_answer_penalty))
    for field in ("term_label", "exam_date", "exam_scope_id", "duration_minutes"):
        if field in fields:
            setattr(paper, field, getattr(data, field))
    if "pass_threshold" in fields:
        threshold = data.pass_threshold
        paper.pass_threshold = None if threshold is None else Decimal(str(threshold))
    return commit_detail(db, paper)


def set_items(db: Session, user: User, paper_id: UUID, data: ExamPaperItems) -> ExamPaperDetail:
    paper, _ = load_paper(db, user, paper_id, mutate=True)
    if paper.status != "DRAFT":
        db.rollback()
        raise HTTPException(409, "Unpublish the paper before changing its questions")
    ids = [item.question_id for item in data.items]
    # Share-lock the questions so none is archived while it is being added.
    statuses = {
        question_id: status
        for question_id, status in db.execute(
            select(Question.id, Question.status)
            .where(Question.id.in_(ids), Question.course_id == paper.course_id)
            .with_for_update(read=True)
        ).tuples()
    }
    if len(statuses) != len(ids):
        db.rollback()
        raise HTTPException(422, "Choose questions from this course")
    unapproved = sum(1 for status in statuses.values() if status != "APPROVED")
    if unapproved:
        db.rollback()
        raise HTTPException(409, f"{unapproved} chosen questions are not approved")
    db.execute(delete(ExamPaperItem).where(ExamPaperItem.paper_id == paper.id))
    db.flush()
    for position, item in enumerate(data.items):
        db.add(
            ExamPaperItem(
                paper_id=paper.id,
                position=position,
                question_id=item.question_id,
                points=Decimal(str(item.points)),
                label=item.label,
            )
        )
    paper.updated_at = datetime.now(UTC)
    return commit_detail(db, paper)


def publish(db: Session, user: User, paper_id: UUID) -> ExamPaperDetail:
    paper, _ = load_paper(db, user, paper_id, mutate=True)
    if paper.status == "PUBLISHED":
        db.rollback()
        return detail(db, paper, True)
    statuses = list(
        db.scalars(
            select(Question.status)
            .join(ExamPaperItem, ExamPaperItem.question_id == Question.id)
            .where(ExamPaperItem.paper_id == paper.id)
            .with_for_update(of=Question, read=True)
        )
    )
    if not statuses:
        db.rollback()
        raise HTTPException(409, "Add at least one question before publishing")
    unapproved = sum(1 for status in statuses if status != "APPROVED")
    if unapproved:
        db.rollback()
        raise HTTPException(409, f"{unapproved} questions in this paper are no longer approved")
    paper.status = "PUBLISHED"
    paper.published_at = datetime.now(UTC)
    return commit_detail(db, paper)


def unpublish(db: Session, user: User, paper_id: UUID) -> ExamPaperDetail:
    paper, _ = load_paper(db, user, paper_id, mutate=True)
    if paper.status == "DRAFT":
        db.rollback()
        return detail(db, paper, True)
    paper.status = "DRAFT"
    paper.published_at = None
    return commit_detail(db, paper)


def delete_paper(db: Session, user: User, paper_id: UUID) -> None:
    paper, _ = load_paper(db, user, paper_id, mutate=True)
    if paper.status != "DRAFT":
        db.rollback()
        raise HTTPException(409, "Unpublish the paper before deleting it")
    db.delete(paper)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not delete exam paper") from None
