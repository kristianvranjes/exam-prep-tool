from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.exam_scope import ExamScopeCopy, ExamScopeCreate, ExamScopeUpdate
from app.schemas.quiz import StartQuiz


def body(**changes):
    return {
        "academic_year": "2025/26",
        "kind": "MIDTERM",
        "name": "Međuispit",
        "unit_ids": [str(uuid4())],
    } | changes


@pytest.mark.parametrize("year", ["2025/26", "1999/00", " 2025/26 "])
def test_academic_years_follow_each_other(year):
    assert ExamScopeCreate.model_validate(body(academic_year=year)).academic_year == year.strip()


@pytest.mark.parametrize("year", ["2025/27", "2025-26", "25/26", "2025/2026", ""])
def test_invalid_academic_years(year):
    with pytest.raises(ValidationError):
        ExamScopeCreate.model_validate(body(academic_year=year))


def test_scope_bodies_require_units_and_real_changes():
    unit = str(uuid4())
    for invalid in (
        body(unit_ids=[]),
        body(unit_ids=[unit, unit]),
        body(kind="EXAM"),
        body(name=" "),
    ):
        with pytest.raises(ValidationError):
            ExamScopeCreate.model_validate(invalid)
    for invalid in ({}, {"name": None}, {"unit_ids": []}, {"unit_ids": [unit, unit]}):
        with pytest.raises(ValidationError):
            ExamScopeUpdate.model_validate(invalid)
    with pytest.raises(ValidationError):
        ExamScopeCopy.model_validate({"from_year": "2025/26", "to_year": "2025/26"})


def test_start_quiz_focus_is_units_or_scope():
    unit = uuid4()
    assert StartQuiz.model_validate({}).unit_ids == []
    assert StartQuiz.model_validate({"unit_ids": [str(unit)]}).unit_ids == [unit]
    assert StartQuiz.model_validate({"exam_scope_id": str(unit)}).exam_scope_id == unit
    for invalid in (
        {"unit_ids": [str(unit), str(unit)]},
        {"unit_ids": [str(unit)], "exam_scope_id": str(uuid4())},
    ):
        with pytest.raises(ValidationError):
            StartQuiz.model_validate(invalid)


@pytest.mark.parametrize("kind", ["LAB", "QUIZ"])
def test_lab_and_quiz_kinds(kind):
    assert ExamScopeCreate.model_validate(body(kind=kind)).kind == kind


def test_scope_dates_are_optional_and_ordered():
    assert ExamScopeCreate.model_validate(body()).starts_on is None
    one_day = ExamScopeCreate.model_validate(body(starts_on="2026-11-23"))
    assert str(one_day.starts_on) == "2026-11-23" and one_day.ends_on is None
    period = ExamScopeCreate.model_validate(body(starts_on="2026-11-23", ends_on="2026-12-01"))
    assert str(period.ends_on) == "2026-12-01"
    for invalid in (
        body(ends_on="2026-12-01"),
        body(starts_on="2026-12-01", ends_on="2026-11-23"),
        body(starts_on="23.11.2026."),
    ):
        with pytest.raises(ValidationError):
            ExamScopeCreate.model_validate(invalid)
    # Null clears a date in an update; the service validates the resulting pair.
    assert ExamScopeUpdate.model_validate({"starts_on": None}).starts_on is None
