"""Pure snapshot-based grading; no database writes or external providers."""

import unicodedata
from dataclasses import dataclass
from typing import Literal

from app.schemas.question import OwnerQuestion
from app.schemas.quiz import AnswerPayload, BooleanAnswer, Grade, MCQAnswer

ALGORITHM_VERSION = "deterministic-v1"
GradingMethod = Literal["DETERMINISTIC", "PENDING_SEMANTIC"]


@dataclass(frozen=True)
class GradingResult:
    status: Grade
    method: GradingMethod
    version: str = ALGORITHM_VERSION


def normalize(text: str) -> str:
    # Canonical Unicode equivalence only: preserve accents, punctuation and math symbols.
    folded = unicodedata.normalize("NFC", text).casefold()
    return " ".join(unicodedata.normalize("NFC", folded).split())


def grade(snapshot: OwnerQuestion, answer: AnswerPayload) -> GradingResult:
    """Return a decision for the submission transaction to persist and freeze.

    A future semantic grader can consume the same inputs and return this result
    contract. Pending is a decision, not a queued AI job or permission to regrade.
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
    else:
        reference = snapshot.reference_answer
        if (
            reference is None
            or not normalize(reference)
            or normalize(answer.text) != normalize(reference)
        ):
            return GradingResult("PENDING", "PENDING_SEMANTIC")
        correct = True
    return GradingResult("CORRECT" if correct else "INCORRECT", "DETERMINISTIC")
