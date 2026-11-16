"""Pure, versioned scoring of a paper session from frozen points and grades."""

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from app.schemas.quiz import Grade

# v2: a partially correct multiple-select answer earns half the item's points and no penalty.
# Sessions frozen under v1 hold no fractions, so they score exactly as before.
SCORING_VERSION = "paper-scoring-v2"
CENT = Decimal("0.01")


@dataclass(frozen=True)
class ItemResult:
    points: Decimal
    # None means the student left the question blank.
    grade: Grade | None
    # The share of the points an INCORRECT answer still earned (partial credit); None means none.
    fraction: Decimal | None = None


@dataclass(frozen=True)
class Score:
    earned: Decimal
    max_points: Decimal
    correct_points: Decimal
    penalty_points: Decimal
    pending_points: Decimal
    unanswered_count: int
    passed: bool | None


def item_points(item: ItemResult, penalty: Decimal) -> Decimal | None:
    """Points one item contributes; None while a short answer awaits self-review."""
    if item.grade == "CORRECT":
        return item.points
    if item.grade == "INCORRECT":
        if item.fraction:
            # Partly right is not wrong: it earns its share and costs nothing.
            return (item.points * item.fraction).quantize(CENT, rounding=ROUND_HALF_UP)
        return -(item.points * penalty).quantize(CENT, rounding=ROUND_HALF_UP)
    if item.grade == "PENDING":
        return None
    return Decimal(0)


def score(items: Sequence[ItemResult], penalty: Decimal, threshold: Decimal | None) -> Score:
    """Correct answers earn their points, wrong objective answers lose `penalty` of
    them, blanks earn 0, and pending short answers are reported separately, never
    guessed. The total may be negative, as on a real paper."""
    earned = correct = deducted = pending = Decimal(0)
    for item in items:
        value = item_points(item, penalty)
        if value is None:
            pending += item.points
        elif value > 0:
            correct += value
        else:
            deducted -= value
        earned += value or 0
    passed: bool | None = None
    if threshold is not None:
        if earned >= threshold:
            passed = True
        elif earned + pending < threshold:
            passed = False
    return Score(
        earned=earned,
        max_points=sum((item.points for item in items), Decimal(0)),
        correct_points=correct,
        penalty_points=deducted,
        pending_points=pending,
        unanswered_count=sum(1 for item in items if item.grade is None),
        passed=passed,
    )
