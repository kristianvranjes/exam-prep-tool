"""Pure, versioned transitions based only on resolved results and submission time."""

from dataclasses import dataclass
from datetime import datetime, timedelta

from app.schemas.quiz import Grade

SCHEDULING_VERSION = "leitner-v1"
DELAYS = (timedelta(minutes=10), *(timedelta(days=n) for n in (1, 3, 7, 14, 30)))


@dataclass(frozen=True)
class Schedule:
    review_stage: int
    due_at: datetime
    scheduling_version: str = SCHEDULING_VERSION


def schedule(previous_stage: int, result: Grade, submitted_at: datetime) -> Schedule | None:
    if result == "PENDING":
        return None
    if not 0 <= previous_stage <= 5:
        raise ValueError("Review stage must be between 0 and 5")
    stage = min(previous_stage + 1, 5) if result == "CORRECT" else 0
    return Schedule(stage, submitted_at + DELAYS[stage])
