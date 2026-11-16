"""Expected points on an exam scope (`exam-estimate-v1`).

For each topic of the scope: the points it carried on the scope's published past papers, times the
caller's accuracy on it in the last 30 days. Read-only and deterministic: no AI, no writes. Only
automatically graded answers of submitted sessions count, as in `course_dashboard`; partial credit
counts as its fraction.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User
from app.models.course_unit import CourseUnit, QuestionUnit
from app.models.exam_paper import ExamPaper, ExamPaperItem
from app.models.exam_scope import ExamScope, ExamScopeUnit
from app.models.quiz import Answer, QuizAttempt, QuizQuestion
from app.schemas.exam_estimate import EstimateRule, ExamEstimate, PointsRange, TopicEstimate
from app.services.course_dashboard import graded_answers
from app.services.courses import get_member_course
from app.services.readiness import wilson

RULE: EstimateRule = "exam-estimate-v1"
WINDOW_DAYS = 30
TARGET_ACCURACY = 0.85
MIN_ANSWERS = 10


@dataclass(frozen=True)
class Evidence:
    """Graded answers in one topic: how many, and how many points' worth were right."""

    answers: int = 0
    right: float = 0.0

    @property
    def accuracy(self) -> float | None:
        return self.right / self.answers if self.answers else None


def exam_points_by_unit(
    papers: list[tuple[UUID, Decimal | None]],
    items: list[tuple[UUID, UUID, Decimal]],
    units_of: dict[UUID, list[UUID]],
) -> tuple[dict[UUID, float], float | None, float | None]:
    """Average points per topic, the average paper total and the average pass threshold.

    An item's points are shared equally between the scope topics its question is linked to; an item
    without a topic in the scope belongs to none of them but still counts in the paper total.
    """
    if not papers:
        return {}, None, None
    totals: dict[UUID, Decimal] = defaultdict(Decimal)
    paper_total = Decimal(0)
    for _, question_id, points in items:
        paper_total += points
        linked = units_of.get(question_id, [])
        for unit_id in linked:
            totals[unit_id] += points / len(linked)
    count = len(papers)
    thresholds = [threshold for _, threshold in papers if threshold is not None]
    return (
        {unit_id: float(points) / count for unit_id, points in totals.items()},
        float(paper_total) / count,
        float(sum(thresholds)) / len(thresholds) if thresholds else None,
    )


def estimate_topics(
    topics: list[tuple[UUID, str, int, float]], evidence: dict[UUID, Evidence]
) -> tuple[list[TopicEstimate], PointsRange | None]:
    """Per-topic estimates and the exam range from topics as (id, title, position, exam points).

    A topic without answers is estimated at the accuracy over all topics, and spans the whole
    interval in the range, so few answers widen it.
    """
    answers = sum(item.answers for item in evidence.values())
    pooled = sum(item.right for item in evidence.values()) / answers if answers else None
    rows: list[TopicEstimate] = []
    expected = low = high = 0.0
    for unit_id, title, position, points in topics:
        seen = evidence.get(unit_id, Evidence())
        accuracy = seen.accuracy if seen.accuracy is not None else pooled
        bottom, top = wilson(seen.right, seen.answers)
        expected += points * accuracy if accuracy is not None else 0.0
        low += points * bottom
        high += points * top
        rows.append(
            TopicEstimate(
                unit_id=unit_id,
                title=title,
                position=position,
                exam_points=round(points, 2),
                answer_count=seen.answers,
                accuracy=None if seen.accuracy is None else round(seen.accuracy, 4),
                expected_points=None if accuracy is None else round(points * accuracy, 2),
                gain_points=(
                    None
                    if accuracy is None
                    else round(max(0.0, points * TARGET_ACCURACY - points * accuracy), 2)
                ),
            )
        )
    rows.sort(key=lambda row: (row.gain_points is None, -(row.gain_points or 0), row.position))
    if answers < MIN_ANSWERS or not rows:
        return rows, None
    return rows, PointsRange(low=round(low, 2), expected=round(expected, 2), high=round(high, 2))


def scope_estimate(db: Session, user: User, scope_id: UUID) -> ExamEstimate:
    course_id = db.scalar(select(ExamScope.course_id).where(ExamScope.id == scope_id))
    if course_id is None:
        raise HTTPException(404, "Exam scope not found")
    get_member_course(db, user, course_id)
    as_of = datetime.now(UTC)
    scope_units = {
        row.id: row
        for row in db.execute(
            select(CourseUnit.id, CourseUnit.title, CourseUnit.position)
            .join(ExamScopeUnit, ExamScopeUnit.unit_id == CourseUnit.id)
            .where(ExamScopeUnit.scope_id == scope_id)
        )
    }
    papers = [
        (paper_id, threshold)
        for paper_id, threshold in db.execute(
            select(ExamPaper.id, ExamPaper.pass_threshold).where(
                ExamPaper.exam_scope_id == scope_id, ExamPaper.status == "PUBLISHED"
            )
        )
    ]
    items = [
        (row.paper_id, row.question_id, row.points)
        for row in db.execute(
            select(ExamPaperItem.paper_id, ExamPaperItem.question_id, ExamPaperItem.points).where(
                ExamPaperItem.paper_id.in_([paper_id for paper_id, _ in papers])
            )
        )
    ]
    units_of: dict[UUID, list[UUID]] = defaultdict(list)
    for question_id, unit_id in db.execute(
        select(QuestionUnit.question_id, QuestionUnit.unit_id).where(
            QuestionUnit.unit_id.in_(scope_units)
        )
    ):
        units_of[question_id].append(unit_id)
    points, max_points, threshold = exam_points_by_unit(papers, items, units_of)

    since = as_of - timedelta(days=WINDOW_DAYS)
    answered = db.execute(
        graded_answers(
            user,
            course_id,
            QuizQuestion.source_question_id,
            Answer.grading_status,
            Answer.score_fraction,
        ).where(QuizAttempt.submitted_at >= since)
    ).all()
    tallies: dict[UUID, list[float]] = defaultdict(lambda: [0, 0.0])
    for question_id, status, fraction in answered:
        right = 1.0 if status == "CORRECT" else float(fraction or 0)
        for unit_id in units_of.get(question_id, []):
            tallies[unit_id][0] += 1
            tallies[unit_id][1] += right
    evidence = {unit_id: Evidence(int(n), right) for unit_id, (n, right) in tallies.items()}

    topics, estimate = estimate_topics(
        [
            (unit_id, scope_units[unit_id].title, scope_units[unit_id].position, value)
            for unit_id, value in points.items()
        ],
        evidence,
    )
    return ExamEstimate(
        scope_id=scope_id,
        rule=RULE,
        as_of=as_of,
        window_days=WINDOW_DAYS,
        target_accuracy=TARGET_ACCURACY,
        paper_count=len(papers),
        answer_count=sum(item.answers for item in evidence.values()),
        min_answers=MIN_ANSWERS,
        max_points=None if max_points is None else round(max_points, 2),
        pass_threshold=None if threshold is None else round(threshold, 2),
        estimate=estimate,
        topics=topics,
    )
