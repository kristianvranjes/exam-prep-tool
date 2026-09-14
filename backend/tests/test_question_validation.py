import pytest
from pydantic import ValidationError

from app.schemas.question import GeneratedQuestions, content_adapter, normalize


def mcq():
    return {
        "type": "MULTIPLE_CHOICE",
        "stem": "Što je stablo?",
        "explanation": "Izvor",
        "options": [
            {"text": "Struktura", "is_correct": True},
            {"text": "Broj", "is_correct": False},
        ],
    }


@pytest.mark.parametrize(
    "payload",
    [
        mcq(),
        {"type": "TRUE_FALSE", "stem": "Test", "correct_answer": False},
        {"type": "SHORT_ANSWER", "stem": "Test", "reference_answer": "Odgovor"},
    ],
)
def test_valid_types(payload):
    assert content_adapter.validate_python(payload).type == payload["type"]
    assert normalize("  ČISTO \n Stablo? ") == "čisto stablo?"


@pytest.mark.parametrize(
    "mode", ["few", "many", "zero", "multiple", "duplicate", "blank", "wrong_shape", "bool", "type"]
)
def test_invalid_mcq(mode):
    payload = mcq()
    if mode == "few":
        payload["options"] = payload["options"][:1]
    if mode == "many":
        payload["options"] *= 4
    if mode == "zero":
        payload["options"][0]["is_correct"] = False
    if mode == "multiple":
        payload["options"][1]["is_correct"] = True
    if mode == "duplicate":
        payload["options"][1]["text"] = " STRUKTURA "
    if mode == "blank":
        payload["options"][0]["text"] = " "
    if mode == "wrong_shape":
        payload["correct_answer"] = True
    if mode == "bool":
        payload["options"][0]["is_correct"] = "true"
    if mode == "type":
        payload["type"] = "FILL_BLANK"
    with pytest.raises(ValidationError):
        content_adapter.validate_python(payload)


@pytest.mark.parametrize(
    "payload",
    [
        {"type": "SHORT_ANSWER", "stem": "Test", "reference_answer": " "},
        {"type": "TRUE_FALSE", "stem": "Test", "correct_answer": 1},
        {"type": "TRUE_FALSE", "stem": "Test", "correct_answer": False, "reference_answer": "x"},
    ],
)
def test_invalid_answer_shapes(payload):
    with pytest.raises(ValidationError):
        content_adapter.validate_python(payload)


def test_generation_requires_explanation_and_citations():
    payload = mcq()
    with pytest.raises(ValidationError):
        GeneratedQuestions.model_validate({"questions": [payload]})
    payload.update(concept_refs=["C1"], source_refs=["S1"])
    assert GeneratedQuestions.model_validate({"questions": [payload]})
    payload["status"] = "APPROVED"
    with pytest.raises(ValidationError):
        GeneratedQuestions.model_validate({"questions": [payload]})
