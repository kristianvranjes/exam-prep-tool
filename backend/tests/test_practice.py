import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.question import OwnerQuestion
from app.schemas.quiz import AnswerPayload, StartQuiz
from app.services.quizzes import grade


@pytest.mark.parametrize(
    "data",
    [
        {"count": 0},
        {"count": 21},
        {"count": True},
        {"count": "2"},
        {"question_types": []},
        {"question_types": ["ESSAY"]},
        {"question_types": ["TRUE_FALSE", "TRUE_FALSE"]},
        {"user_id": "fake"},
    ],
)
def test_invalid_start(data):
    with pytest.raises(ValidationError):
        StartQuiz.model_validate(data)


@pytest.mark.parametrize(
    "data",
    [
        {"type": "TRUE_FALSE", "value": "false"},
        {"type": "TRUE_FALSE", "value": 0},
        {"type": "MULTIPLE_CHOICE", "option_position": True},
        {"type": "MULTIPLE_CHOICE", "option_position": -1},
        {"type": "SHORT_ANSWER", "text": " "},
        {"type": "SHORT_ANSWER", "text": "x" * 2001},
        {"type": "TRUE_FALSE", "value": True, "grading_status": "CORRECT"},
    ],
)
def test_invalid_answer(data):
    with pytest.raises(ValidationError):
        TypeAdapter(AnswerPayload).validate_python(data)


@pytest.mark.parametrize(
    "payload,expected",
    [
        ({"type": "MULTIPLE_CHOICE", "option_position": 0}, "CORRECT"),
        ({"type": "MULTIPLE_CHOICE", "option_position": 1}, "INCORRECT"),
        ({"type": "TRUE_FALSE", "value": False}, "CORRECT"),
        ({"type": "TRUE_FALSE", "value": True}, "INCORRECT"),
        ({"type": "SHORT_ANSWER", "text": "Even an exact reference match"}, "PENDING"),
    ],
)
def test_deterministic_grading(payload, expected):
    from app.schemas.question import OwnerOption

    content = OwnerQuestion.model_construct(
        correct_boolean=False,
        options=[
            OwnerOption(position=0, text="A", is_correct=True),
            OwnerOption(position=1, text="B", is_correct=False),
        ],
    )
    assert grade(content, TypeAdapter(AnswerPayload).validate_python(payload)) == expected
