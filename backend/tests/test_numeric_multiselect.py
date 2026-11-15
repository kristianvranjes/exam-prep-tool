from decimal import Decimal

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.question import GenerationRequest, OwnerQuestion, QuizImport, content_adapter
from app.schemas.quiz import AnswerPayload
from app.services.grading import NUMERIC_VERSION, PARTIAL_SET_VERSION, grade

answers: TypeAdapter[AnswerPayload] = TypeAdapter(AnswerPayload)
NUMERIC = {"type": "NUMERIC", "stem": "Gravity at sea level?", "correct_value": "9,81"}
SELECT = {
    "type": "MULTIPLE_SELECT",
    "stem": "Which are prime?",
    "options": [
        {"text": "2", "is_correct": True},
        {"text": "3", "is_correct": True},
        {"text": "4", "is_correct": False},
    ],
}


def snapshot(content: dict) -> OwnerQuestion:
    question = content_adapter.validate_python(content)
    options = [
        {"position": i, "text": o.text, "is_correct": o.is_correct}
        for i, o in enumerate(getattr(question, "options", []))
    ]
    return OwnerQuestion.model_validate(
        {
            "id": "00000000-0000-0000-0000-000000000001",
            "course_id": "00000000-0000-0000-0000-000000000002",
            "created_by_user_id": "00000000-0000-0000-0000-000000000003",
            "ai_job_id": None,
            "status": "APPROVED",
            "source": "USER",
            "correct_boolean": None,
            "reference_answer": None,
            "reviewed_by_user_id": None,
            "reviewed_at": None,
            "rejection_reason": None,
            "created_at": "2026-10-21T10:00:00Z",
            "updated_at": "2026-10-21T10:00:00Z",
            **question.model_dump(exclude={"options"}),
            "options": options,
        }
    )


def test_numeric_content_accepts_authoring_forms_and_bounds_tolerances():
    for value in ("9,81", "9.81", 9.81):
        assert content_adapter.validate_python(
            NUMERIC | {"correct_value": value}
        ).correct_value == (Decimal("9.81"))
    full = content_adapter.validate_python(
        NUMERIC | {"absolute_tolerance": 0.05, "relative_tolerance": "0,01", "unit": " m/s² "}
    )
    assert (full.absolute_tolerance, full.relative_tolerance, full.unit) == (
        Decimal("0.05"),
        Decimal("0.01"),
        "m/s²",
    )
    for invalid in (
        {"correct_value": "1,234.5"},
        {"correct_value": "abc"},
        {"correct_value": True},
        {"absolute_tolerance": -1},
        {"relative_tolerance": 1.5},
        {"unit": "x" * 21},
        {"correct_value": None},
    ):
        with pytest.raises(ValidationError):
            content_adapter.validate_python(NUMERIC | invalid)


def test_multiple_select_needs_a_correct_option_and_distinct_texts():
    assert content_adapter.validate_python(SELECT).type == "MULTIPLE_SELECT"
    no_key = SELECT | {
        "options": [{"text": "a", "is_correct": False}, {"text": "b", "is_correct": False}]
    }
    duplicate = SELECT | {
        "options": [{"text": "a", "is_correct": True}, {"text": " A ", "is_correct": False}]
    }
    for invalid in (no_key, duplicate, SELECT | {"options": SELECT["options"][:1]}):
        with pytest.raises(ValidationError):
            content_adapter.validate_python(invalid)


def test_answer_payloads_validate_numbers_and_option_sets():
    assert answers.validate_python({"type": "NUMERIC", "value": "9,81"}).value == "9,81"
    assert answers.validate_python(
        {"type": "MULTIPLE_SELECT", "option_positions": [2, 0]}
    ).option_positions == [0, 2]
    for invalid in (
        {"type": "NUMERIC", "value": "1.234,5"},
        {"type": "NUMERIC", "value": "9.81 m/s"},
        {"type": "NUMERIC", "value": ""},
        {"type": "NUMERIC", "value": 9.81},
        {"type": "MULTIPLE_SELECT", "option_positions": []},
        {"type": "MULTIPLE_SELECT", "option_positions": [1, 1]},
        {"type": "MULTIPLE_SELECT", "option_positions": [6]},
    ):
        with pytest.raises(ValidationError):
            answers.validate_python(invalid)


def test_numeric_grading_is_inclusive_at_the_tolerance_boundary():
    key = snapshot(NUMERIC | {"absolute_tolerance": "0.05"})
    for value, status in (("9,86", "CORRECT"), ("9.76", "CORRECT"), ("9.8601", "INCORRECT")):
        result = grade(key, answers.validate_python({"type": "NUMERIC", "value": value}))
        assert (result.status, result.method, result.version) == (
            status,
            "DETERMINISTIC",
            NUMERIC_VERSION,
        )
    exact = snapshot(NUMERIC)
    assert grade(exact, answers.validate_python({"type": "NUMERIC", "value": "9.810"})).status == (
        "CORRECT"
    )
    assert grade(exact, answers.validate_python({"type": "NUMERIC", "value": "9.8"})).status == (
        "INCORRECT"
    )


def test_multiple_select_grade_needs_the_exact_set_and_scores_half_for_an_incomplete_one():
    key = snapshot(SELECT)  # the correct options are 0 and 1
    cases = (
        ([0, 1], "CORRECT", 1),
        ([0], "INCORRECT", 0.5),  # right but incomplete
        ([1], "INCORRECT", 0.5),
        ([0, 1, 2], "INCORRECT", 0),  # everything right plus a wrong one
        ([0, 2], "INCORRECT", 0),
        ([2], "INCORRECT", 0),
    )
    for positions, status, fraction in cases:
        result = grade(
            key, answers.validate_python({"type": "MULTIPLE_SELECT", "option_positions": positions})
        )
        assert (result.status, result.version) == (status, PARTIAL_SET_VERSION)
        assert result.fraction == fraction, positions
    # Other types are all or nothing: no fraction.
    assert (
        grade(
            snapshot(NUMERIC), answers.validate_python({"type": "NUMERIC", "value": "9.81"})
        ).fraction
        is None
    )
    with pytest.raises(ValueError):
        grade(key, answers.validate_python({"type": "MULTIPLE_SELECT", "option_positions": [5]}))


def test_import_versions_and_generation_keep_their_types():
    v2 = QuizImport.model_validate({"version": "quiz-import-v2", "questions": [NUMERIC, SELECT]})
    assert [q.type for q in v2.questions] == ["NUMERIC", "MULTIPLE_SELECT"]
    with pytest.raises(ValidationError, match="quiz-import-v2"):
        QuizImport.model_validate({"version": "quiz-import-v1", "questions": [NUMERIC]})
    with pytest.raises(ValidationError):
        GenerationRequest.model_validate(
            {"concept_ids": ["00000000-0000-0000-0000-000000000001"], "question_types": ["NUMERIC"]}
        )
