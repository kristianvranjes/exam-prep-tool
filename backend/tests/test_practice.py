from typing import get_args

import pytest
from pydantic import TypeAdapter, ValidationError

from app.models.quiz import RECORDED_SELECTION_MODES
from app.schemas.favorite import FavoriteState
from app.schemas.question import OwnerQuestion
from app.schemas.quiz import (
    ActiveQuestion,
    AnswerPayload,
    CheckAnswer,
    SelectionMode,
    StartQuiz,
)
from app.services.grading import grade
from app.services.quiz_selection import spread


@pytest.mark.parametrize(
    "data",
    [
        {"selection_mode": "UNKNOWN"},
        {"selection_mode": None},
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
        {"type": "SHORT_ANSWER", "text": "\t\n\u00a0"},
        {"type": "SHORT_ANSWER", "text": "a\x00b"},
        {"type": "SHORT_ANSWER", "text": "a\ud800b"},
        {"type": "SHORT_ANSWER", "text": "text", "grading_method": "DETERMINISTIC"},
        {"type": "SHORT_ANSWER", "text": "text", "grading_version": "fake"},
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
        ({"type": "SHORT_ANSWER", "text": "A different answer"}, "PENDING"),
    ],
)
def test_deterministic_grading(payload, expected):
    from app.schemas.question import OwnerOption

    content = OwnerQuestion.model_construct(
        type=payload["type"],
        reference_answer="Reference answer",
        correct_boolean=False,
        options=[
            OwnerOption(position=0, text="A", is_correct=True),
            OwnerOption(position=1, text="B", is_correct=False),
        ],
    )
    assert grade(content, TypeAdapter(AnswerPayload).validate_python(payload)).status == expected


def test_selection_mode_defaults_to_standard():
    assert StartQuiz().selection_mode == "STANDARD"
    assert StartQuiz(selection_mode="ADAPTIVE").selection_mode == "ADAPTIVE"


def test_quick_quiz_is_an_adaptive_preset():
    assert StartQuiz().quick_quiz is False
    assert StartQuiz(selection_mode="ADAPTIVE", quick_quiz=True).quick_quiz is True
    for mode in ("STANDARD", "MISTAKES", "DUE", "FAVORITES"):
        with pytest.raises(ValidationError, match="ADAPTIVE"):
            StartQuiz.model_validate({"selection_mode": mode, "quick_quiz": True})
    with pytest.raises(ValidationError):
        StartQuiz.model_validate({"selection_mode": "ADAPTIVE", "quick_quiz": "yes"})


def test_recorded_modes_cover_every_start_path():
    # The ck_quiz_selection_mode values: each request mode, the quick quiz and papers.
    assert set(RECORDED_SELECTION_MODES) == {*get_args(SelectionMode), "QUICK", "PAPER"}
    assert len(RECORDED_SELECTION_MODES) == len(set(RECORDED_SELECTION_MODES))
    assert all(len(mode) <= 10 for mode in RECORDED_SELECTION_MODES)


@pytest.mark.parametrize("mode", ["MISTAKES", "DUE", "FAVORITES"])
def test_review_modes_combine_with_any_focus(mode):
    assert StartQuiz(selection_mode=mode).selection_mode == mode
    unit = "00000000-0000-0000-0000-000000000001"
    assert StartQuiz.model_validate({"selection_mode": mode, "unit_ids": [unit]}).unit_ids
    assert StartQuiz.model_validate({"selection_mode": mode, "exam_scope_id": unit}).exam_scope_id


def test_favorite_state_and_active_question_carry_the_source():
    source = "00000000-0000-0000-0000-000000000002"
    state = FavoriteState.model_validate(
        {"question_id": source, "favorite": False, "favorited_at": None}
    )
    assert state.favorite is False and state.favorited_at is None
    question = ActiveQuestion.model_validate(
        {
            "id": "00000000-0000-0000-0000-000000000001",
            "source_question_id": source,
            "position": 0,
            "type": "TRUE_FALSE",
            "stem": "Is it true?",
            "difficulty": None,
            "options": [],
            "answer": None,
        }
    )
    # Not a favorite until the student adds one; never part of the snapshot.
    assert question.favorite is False
    with pytest.raises(ValidationError):
        ActiveQuestion.model_validate(question.model_dump() | {"source_question_id": None})


def test_mock_exam_needs_an_exam_scope():
    unit = "00000000-0000-0000-0000-000000000001"
    for data in [{}, {"unit_ids": [unit]}]:
        with pytest.raises(ValidationError, match="mock exam needs an exam scope"):
            StartQuiz.model_validate({"selection_mode": "MOCK", **data})
    # Only a mock exam may be larger than generated practice, up to the size of a paper.
    mock = StartQuiz.model_validate({"selection_mode": "MOCK", "exam_scope_id": unit, "count": 60})
    assert mock.count == 60
    with pytest.raises(ValidationError):
        StartQuiz.model_validate({"selection_mode": "MOCK", "exam_scope_id": unit, "count": 61})
    with pytest.raises(ValidationError, match="At most 20 questions"):
        StartQuiz.model_validate({"selection_mode": "ADAPTIVE", "count": 21})


def test_spread_round_robins_units_in_order():
    units = [["a1", "a2", "a3", "a4"], ["b1", "b2", "b3"], ["c1", "c2"]]
    # Seven questions over three units: 3 + 2 + 2, listed unit by unit.
    assert spread(units, 7) == ["a1", "a2", "a3", "b1", "b2", "c1", "c2"]
    assert spread(units, 2) == ["a1", "b1"]
    assert spread(units, 0) == []


def test_spread_fills_from_remaining_units_and_counts_shared_questions_once():
    units = [["shared", "a1"], ["shared", "b1", "b2", "b3", "b4"], []]
    # Unit A takes the shared question first; B moves on, then fills once A runs out.
    assert spread(units, 5) == ["shared", "a1", "b1", "b2", "b3"]
    assert spread(units, 10) == ["shared", "a1", "b1", "b2", "b3", "b4"]
    assert spread([[], []], 3) == []


@pytest.mark.parametrize("mode", ["", "TUTOR", None, "immediate"])
def test_invalid_feedback_mode(mode):
    with pytest.raises(ValidationError):
        StartQuiz.model_validate({"feedback_mode": mode})


def test_feedback_mode_defaults_to_end():
    assert StartQuiz.model_validate({}).feedback_mode == "END"
    assert StartQuiz.model_validate({"feedback_mode": "IMMEDIATE"}).feedback_mode == "IMMEDIATE"


@pytest.mark.parametrize(
    "data", [{"confidence": "MAYBE"}, {"confidence": "sure"}, {"grading_status": "CORRECT"}]
)
def test_invalid_check(data):
    with pytest.raises(ValidationError):
        CheckAnswer.model_validate(data)


def test_check_confidence_is_optional():
    assert CheckAnswer.model_validate({}).confidence is None
    assert CheckAnswer.model_validate({"confidence": "GUESS"}).confidence == "GUESS"
