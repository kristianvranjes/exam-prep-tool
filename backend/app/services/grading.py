"""Pure snapshot-based grading; no database writes or external providers."""

import unicodedata
from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal
from typing import Literal

from app.schemas.question import OwnerQuestion
from app.schemas.quiz import (
    AnswerPayload,
    BlanksAnswer,
    BooleanAnswer,
    Grade,
    MatchAnswer,
    MCQAnswer,
    MultipleSelectAnswer,
    NumericAnswer,
)
from app.services.interactive import blank_key, computes_key, fits
from app.services.numbers import parse_number, within_tolerance

ALGORITHM_VERSION = "deterministic-v1"
# New types record their own rule, leaving earlier provenance untouched.
NUMERIC_VERSION = "numeric-tolerance-v1"
EXACT_SET_VERSION = "exact-set-v1"
# Multiple select with partial credit: half the points for a correct but incomplete selection.
PARTIAL_SET_VERSION = "partial-set-v1"
HALF = Decimal("0.5")
MATCH_VERSION = "match-v1"
# Tables and timing diagrams: the share of blanks right, rounded down to whole percent.
BLANKS_VERSION = "blanks-v1"
# Circuits: right when the chosen gates compute the key's outputs for every input.
CIRCUIT_VERSION = "circuit-equivalence-v1"
CENT = Decimal("0.01")
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


def correct_slots(snapshot: OwnerQuestion) -> list[int]:
    """For each left item, the shown right-hand item that is its partner."""
    count = len(snapshot.options)
    if sorted(snapshot.right_order) != list(range(count)):
        raise ValueError("Match snapshot has no valid order")
    return [snapshot.right_order.index(left) for left in range(count)]


def grade_match(snapshot: OwnerQuestion, answer: MatchAnswer) -> GradingResult:
    """All pairs right is correct. Some pairs right and none wrong, because the rest were left
    open, earns half the points; any wrong pair, or no right one, earns none."""
    key = correct_slots(snapshot)
    if len(answer.matches) != len(key):
        raise ValueError("Answer does not match the pairs in the snapshot")
    right = sum(match == slot for match, slot in zip(answer.matches, key, strict=True))
    wrong = sum(
        match is not None and match != slot for match, slot in zip(answer.matches, key, strict=True)
    )
    if right == len(key):
        return GradingResult("CORRECT", "DETERMINISTIC", MATCH_VERSION, Decimal(1))
    partial = right > 0 and wrong == 0
    return GradingResult(
        "INCORRECT", "DETERMINISTIC", MATCH_VERSION, HALF if partial else Decimal(0)
    )


def grade_blanks(snapshot: OwnerQuestion, answer: BlanksAnswer) -> GradingResult:
    """A circuit is right or wrong as a whole; a table or timing diagram earns the share of its
    blanks filled in right, and is correct only when all are."""
    spec = snapshot.spec
    if spec is None or not fits(snapshot.type, spec, answer.values):
        raise ValueError("Answer does not fit the blanks in the snapshot")
    if snapshot.type == "CIRCUIT":
        if any(value is None for value in answer.values):
            return GradingResult("INCORRECT", "DETERMINISTIC", CIRCUIT_VERSION, Decimal(0))
        right_circuit = computes_key(spec, [value for value in answer.values if value])
        return GradingResult(
            "CORRECT" if right_circuit else "INCORRECT",
            "DETERMINISTIC",
            CIRCUIT_VERSION,
            Decimal(1) if right_circuit else Decimal(0),
        )
    key = blank_key(snapshot.type, spec)
    right = sum(
        value is not None and normalize(value) == normalize(expected)
        for value, expected in zip(answer.values, key, strict=True)
    )
    if right == len(key):
        return GradingResult("CORRECT", "DETERMINISTIC", BLANKS_VERSION, Decimal(1))
    share = (Decimal(right) / Decimal(len(key))).quantize(CENT, rounding=ROUND_FLOOR)
    return GradingResult("INCORRECT", "DETERMINISTIC", BLANKS_VERSION, share)


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
    elif isinstance(answer, MatchAnswer):
        return grade_match(snapshot, answer)
    elif isinstance(answer, BlanksAnswer):
        return grade_blanks(snapshot, answer)
    else:
        return GradingResult("PENDING", "PENDING_SEMANTIC")
    return GradingResult("CORRECT" if correct else "INCORRECT", "DETERMINISTIC")
