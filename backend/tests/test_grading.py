import pytest

from app.schemas.question import OwnerQuestion
from app.schemas.quiz import BooleanAnswer, MCQAnswer, TextAnswer
from app.services.grading import ALGORITHM_VERSION, grade


@pytest.mark.parametrize(
    "reference,raw",
    [
        ("Mass attracts mass", "Mass attracts mass"),
        ("Mass attracts mass", "MASS ATTRACTS MASS"),
        ("Mass attracts mass", " \tMass attracts mass\n"),
        ("Mass attracts mass", "Mass  attracts\n\tmass"),
        ("  Mass\tattracts mass ", "Mass attracts mass"),
        ("Café", "CAFE\u0301"),
        ("Straße", "STRASSE"),
        ("α β", "Α\u00a0Β"),
        ("Mass attracts mass", "Mass repels mass"),
        ("Mass attracts mass", "Mass does not attract mass"),
        ("Café", "Cafe"),
        ("x²", "x2"),
        ("-2", "2"),
        ("1.5", "15"),
        ("alpha beta", "beta alpha"),
        ("ab", "a\u200bb"),
        (None, "An answer"),
        (" ", "An answer"),
    ],
)
def test_short_answer_is_always_pending_and_preserves_input(reference, raw):
    snapshot = OwnerQuestion.model_construct(type="SHORT_ANSWER", reference_answer=reference)
    answer = TextAnswer(type="SHORT_ANSWER", text=raw)
    result = grade(snapshot, answer)
    assert result.status == "PENDING"
    assert result.method == "PENDING_SEMANTIC"
    assert result.version == ALGORITHM_VERSION
    assert answer.text == raw
    assert snapshot.reference_answer == reference


def test_grader_rejects_mismatched_type_and_option():
    snapshot = OwnerQuestion.model_construct(type="MULTIPLE_CHOICE", options=[])
    with pytest.raises(ValueError, match="type"):
        grade(snapshot, BooleanAnswer(type="TRUE_FALSE", value=True))
    with pytest.raises(ValueError, match="option"):
        grade(snapshot, MCQAnswer(type="MULTIPLE_CHOICE", option_position=0))
