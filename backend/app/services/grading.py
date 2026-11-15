"""Pure snapshot-based grading; no database writes or external providers."""

import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from app.schemas.question import OwnerQuestion
from app.schemas.quiz import (
    AnswerPayload,
    BooleanAnswer,
    Grade,
    MCQAnswer,
    MultipleSelectAnswer,
    NumericAnswer,
)
from app.services.numbers import parse_number, within_tolerance

ALGORITHM_VERSION = "deterministic-v1"
# New types record their own rule, leaving earlier provenance untouched.
NUMERIC_VERSION = "numeric-tolerance-v1"
EXACT_SET_VERSION = "exact-set-v1"
# Multiple select with partial credit: half the points for a correct but incomplete selection.
PARTIAL_SET_VERSION = "partial-set-v1"
HALF = Decimal("0.5")
GradingMethod = Literal["DETERMINISTIC", "PENDING_SEMANTIC"]


@dataclass(frozen=True)
class GradingResult:
    status: Grade
    method: GradingMethod
    version: str = ALGORITHM_VERSION
    # The share of the item's points earned, for types that can score partially; the grade
    # stays CORRECT or INCORRECT. None means all or nothing by the grade.
    fraction: Decimal | None = None


def normalize(text: str) -> str:
    # Canonical Unicode equivalence only: preserve accents, punctuation and math symbols.
    folded = unicodedata.normalize("NFC", text).casefold()
    return " ".join(unicodedata.normalize("NFC", folded).split())


def grade(snapshot: OwnerQuestion, answer: AnswerPayload) -> GradingResult:
    """Return a decision for the submission transaction to persist and freeze.

    Pending short answers are intentionally ungraded, not queued for regrading.
    """
    if snapshot.type != answer.type:
        raise ValueError("Answer type does not match snapshot")
    if isinstance(answer, MCQAnswer):
        option = next((o for o in snapshot.options if o.position == answer.option_position), None)
        if option is None:
            raise ValueError("Answer option does not exist in snapshot")
        correct = option.is_correct
    elif isinstance(answer, BooleanAnswer):
        correct = answer.value == snapshot.correct_boolean
    elif isinstance(answer, NumericAnswer):
        if snapshot.correct_value is None:
            raise ValueError("Numeric snapshot has no key")
        correct = within_tolerance(
            parse_number(answer.value),
            snapshot.correct_value,
            snapshot.absolute_tolerance,
            snapshot.relative_tolerance,
        )
        return GradingResult(
            "CORRECT" if correct else "INCORRECT", "DETERMINISTIC", NUMERIC_VERSION
        )
    elif isinstance(answer, MultipleSelectAnswer):
        positions = {o.position for o in snapshot.options}
        if not set(answer.option_positions) <= positions:
            raise ValueError("Answer option does not exist in snapshot")
        key = {o.position for o in snapshot.options if o.is_correct}
        chosen = set(answer.option_positions)
        if chosen == key:
            return GradingResult("CORRECT", "DETERMINISTIC", PARTIAL_SET_VERSION, Decimal(1))
        # Some correct options marked, none wrong, some correct ones missing: half the points.
        partial = bool(chosen) and chosen < key
        return GradingResult(
            "INCORRECT", "DETERMINISTIC", PARTIAL_SET_VERSION, HALF if partial else Decimal(0)
        )
    else:
        return GradingResult("PENDING", "PENDING_SEMANTIC")
    return GradingResult("CORRECT" if correct else "INCORRECT", "DETERMINISTIC")
