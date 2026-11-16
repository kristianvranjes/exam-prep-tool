from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

EstimateRule = Literal["exam-estimate-v1"]


class PointsRange(BaseModel):
    """Points the caller would expect on the exam today."""

    low: float
    expected: float
    high: float


class TopicEstimate(BaseModel):
    unit_id: UUID
    title: str
    position: int
    # Average points the topic carried on the scope's published past papers.
    exam_points: float
    # Graded answers of the caller in this topic inside the window; the accuracy sample.
    answer_count: int
    # Null without answers; partial credit counts as its fraction.
    accuracy: float | None
    # exam_points x accuracy; a topic without answers uses the accuracy over all topics.
    expected_points: float | None
    # Points still to gain if accuracy reached the target; null while nothing can be estimated.
    gain_points: float | None


class ExamEstimate(BaseModel):
    scope_id: UUID
    rule: EstimateRule
    as_of: datetime
    window_days: int
    # Accuracy the "gain" column aims for.
    target_accuracy: float
    # Published past papers of the scope the estimate is based on.
    paper_count: int
    # Graded answers in the window across the scope's topics.
    answer_count: int
    # Answers needed before a range is given.
    min_answers: int
    # Average total points and pass threshold of those papers; null when none say so.
    max_points: float | None
    pass_threshold: float | None
    # Null without papers, or until `min_answers` answers exist.
    estimate: PointsRange | None
    # Topics that carried points, most points to gain first.
    topics: list[TopicEstimate]
