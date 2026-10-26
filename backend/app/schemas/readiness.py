from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

ReadinessRule = Literal["readiness-v1"]


class ReadinessRange(BaseModel):
    """Estimated share of questions answered correctly today, from 0 to 1."""

    low: float
    high: float


class UnitReadiness(BaseModel):
    """The caller's evidence for one scope unit.

    Counts cover approved, automatically graded questions currently linked to the unit;
    a question linked to several scope units counts in each of them.
    """

    unit_id: UUID
    title: str
    position: int
    is_archived: bool
    question_count: int
    # Questions with at least one graded answer from the caller.
    answered_count: int
    # Answered questions whose last answer was correct and is not long overdue.
    retained_count: int
    # Graded answers, including repeats: the accuracy sample.
    answer_count: int
    correct_answer_count: int
    # Ratios are null when their sample is empty.
    coverage: float | None
    accuracy: float | None
    retention: float | None
    # Null when the unit has no questions to practise.
    readiness: ReadinessRange | None


class ExamScopeReadiness(BaseModel):
    scope_id: UUID
    rule: ReadinessRule
    as_of: datetime
    # Distinct questions across the scope's units.
    question_count: int
    answered_count: int
    retained_count: int
    answer_count: int
    correct_answer_count: int
    # Answered questions needed before a scope range is given.
    min_answered: int
    # Null until `min_answered` questions are answered.
    readiness: ReadinessRange | None
    units: list[UnitReadiness]
    # Up to three active units with something left to practise, weakest first.
    weakest_unit_ids: list[UUID]
