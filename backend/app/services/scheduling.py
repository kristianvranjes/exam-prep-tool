"""Pure, versioned transitions based only on resolved results and submission time."""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from app.schemas.quiz import Grade

SCHEDULING_VERSION = "leitner-v1"
DELAYS = (timedelta(minutes=10), *(timedelta(days=n) for n in (1, 3, 7, 14, 30)))


@dataclass(frozen=True)
class Schedule:
    review_stage: int
    due_at: datetime
    scheduling_version: str = SCHEDULING_VERSION


SRS_VERSION = "srs-v2"
Rating = Literal["AGAIN", "HARD", "GOOD", "EASY"]
# A card whose gap has reached this is mature; before that it is still being learned.
MATURE_AFTER = timedelta(days=21)
AGAIN_DELAY = timedelta(minutes=10)
MIN_INTERVAL = timedelta(days=1)
MAX_INTERVAL = timedelta(days=365)
# The growth of the gap after a successful review, from the handoff's mockup.
FACTORS: dict[str, float] = {"HARD": 1.2, "GOOD": 2.5, "EASY": 3.3}
_ZAGREB = ZoneInfo("Europe/Zagreb")


@dataclass(frozen=True)
class RatedSchedule:
    """The scheduling fields a rating leaves on a card."""

    interval_minutes: int
    due_at: datetime
    repetitions: int
    lapses: int
    scheduling_version: str = SRS_VERSION


def rating_for_result(result: Grade) -> Rating | None:
    """What a graded answer counts as for a card already on srs-v2; short answers wait."""
    if result == "CORRECT":
        return "GOOD"
    if result == "INCORRECT":
        return "AGAIN"
    return None


def schedule_rating(
    previous_interval_minutes: int | None,
    repetitions: int,
    lapses: int,
    rating: Rating,
    rated_at: datetime,
    exam_start: date | None = None,
) -> RatedSchedule:
    """Next review after a rating (srs-v2, option A).

    AGAIN brings the card back in 10 minutes and counts a lapse. The other ratings multiply the
    previous gap (at least one day) by 1.2, 2.5 or 3.3, up to a year. The due time never passes
    the start of the exam day when that is still ahead; the stored interval is the uncapped one,
    so the gap keeps growing once the exam is over.
    """
    if rating == "AGAIN":
        return RatedSchedule(
            int(AGAIN_DELAY.total_seconds() // 60), rated_at + AGAIN_DELAY, 0, lapses + 1
        )
    base = max(timedelta(minutes=previous_interval_minutes or 0), MIN_INTERVAL)
    interval = min(base * FACTORS[rating], MAX_INTERVAL)
    minutes = round(interval.total_seconds() / 60)
    due_at = rated_at + timedelta(minutes=minutes)
    if exam_start is not None:
        exam_day = datetime.combine(exam_start, time.min, tzinfo=_ZAGREB)
        if exam_day > rated_at + AGAIN_DELAY:
            due_at = min(due_at, exam_day)
    return RatedSchedule(minutes, due_at, repetitions + 1, lapses)


def schedule(previous_stage: int, result: Grade, submitted_at: datetime) -> Schedule | None:
    if result == "PENDING":
        return None
    if not 0 <= previous_stage <= 5:
        raise ValueError("Review stage must be between 0 and 5")
    stage = min(previous_stage + 1, 5) if result == "CORRECT" else 0
    return Schedule(stage, submitted_at + DELAYS[stage])
