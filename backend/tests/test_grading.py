import pytest

from app.schemas.question import OwnerQuestion
from app.schemas.quiz import BooleanAnswer, MCQAnswer, TextAnswer
from app.services.grading import ALGORITHM_VERSION, grade


@pytest.mark.parametrize(
    "reference,raw,expected",
    [
        ("Mass attracts mass", "Mass attracts mass", "CORRECT"),
        ("Mass attracts mass", "MASS ATTRACTS MASS", "CORRECT"),
        ("Mass attracts mass", " \tMass attracts mass\n", "CORRECT"),
        ("Mass attracts mass", "Mass  attracts\n\tmass", "CORRECT"),
        ("  Mass\tattracts mass ", "Mass attracts mass", "CORRECT"),
        ("Café", "CAFE\u0301", "CORRECT"),
        ("Straße", "STRASSE", "CORRECT"),
        ("α β", "Α\u00a0Β", "CORRECT"),
        ("Mass attracts mass", "Mass repels mass", "PENDING"),
        ("Mass attracts mass", "Mass does not attract mass", "PENDING"),
        ("Café", "Cafe", "PENDING"),
        ("x²", "x2", "PENDING"),
        ("-2", "2", "PENDING"),
        ("1.5", "15", "PENDING"),
        ("alpha beta", "beta alpha", "PENDING"),
        ("ab", "a\u200bb", "PENDING"),
        (None, "An answer", "PENDING"),
        (" ", "An answer", "PENDING"),
    ],
)
def test_short_answer_comparison_preserves_input(reference, raw, expected):
    snapshot = OwnerQuestion.model_construct(type="SHORT_ANSWER", reference_answer=reference)
    answer = TextAnswer(type="SHORT_ANSWER", text=raw)
    result = grade(snapshot, answer)
    assert result.status == expected
    assert result.method == ("DETERMINISTIC" if expected == "CORRECT" else "PENDING_SEMANTIC")
    assert result.version == ALGORITHM_VERSION
    assert answer.text == raw
    assert snapshot.reference_answer == reference


def test_grader_rejects_mismatched_type_and_option():
    snapshot = OwnerQuestion.model_construct(type="MULTIPLE_CHOICE", options=[])
    with pytest.raises(ValueError, match="type"):
        grade(snapshot, BooleanAnswer(type="TRUE_FALSE", value=True))
    with pytest.raises(ValueError, match="option"):
        grade(snapshot, MCQAnswer(type="MULTIPLE_CHOICE", option_position=0))
