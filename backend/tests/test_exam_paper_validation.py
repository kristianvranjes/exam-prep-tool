from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.exam_paper import ExamPaperCreate, ExamPaperItems, ExamPaperUpdate


def body(**changes):
    return {"academic_year": "2025/26", "kind": "MIDTERM", "title": "MI"} | changes


def test_paper_defaults_and_accepted_values():
    paper = ExamPaperCreate.model_validate(body())
    assert (paper.wrong_answer_penalty, paper.duration_minutes, paper.exam_date) == (0, None, None)
    full = ExamPaperCreate.model_validate(
        body(
            kind="QUIZ",
            wrong_answer_penalty=0.333,
            pass_threshold=12.5,
            exam_date="2026-11-23",
            duration_minutes=600,
            exam_scope_id=str(uuid4()),
            term_label=" Zimski rok ",
        )
    )
    assert (full.wrong_answer_penalty, full.pass_threshold, full.term_label) == (
        0.333,
        12.5,
        "Zimski rok",
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"title": " "},
        {"kind": "EXAM"},
        {"academic_year": "2025/27"},
        {"wrong_answer_penalty": 1.5},
        {"wrong_answer_penalty": 0.3333},
        {"duration_minutes": 0},
        {"duration_minutes": 601},
        {"pass_threshold": -1},
        {"pass_threshold": 1.005},
        {"status": "PUBLISHED"},
    ],
)
def test_invalid_papers(changes):
    with pytest.raises(ValidationError):
        ExamPaperCreate.model_validate(body(**changes))


def test_updates_need_a_change_and_keep_required_fields():
    for invalid in ({}, {"title": None}, {"kind": None}, {"wrong_answer_penalty": None}):
        with pytest.raises(ValidationError):
            ExamPaperUpdate.model_validate(invalid)
    cleared = ExamPaperUpdate.model_validate({"duration_minutes": None, "exam_scope_id": None})
    assert cleared.model_fields_set == {"duration_minutes", "exam_scope_id"}


def test_items_are_unique_bounded_and_pointed():
    question = str(uuid4())
    assert ExamPaperItems.model_validate({"items": []}).items == []
    ok = ExamPaperItems.model_validate(
        {"items": [{"question_id": question, "points": 2.5, "label": "3a"}]}
    )
    assert ok.items[0].points == 2.5
    for invalid in (
        [{"question_id": question, "points": 1}] * 2,
        [{"question_id": question, "points": 0}],
        [{"question_id": question, "points": 1001}],
        [{"question_id": question, "points": 0.125}],
        [{"question_id": question, "points": 1, "label": "x" * 41}],
        [{"question_id": str(uuid4()), "points": 1} for _ in range(61)],
    ):
        with pytest.raises(ValidationError):
            ExamPaperItems.model_validate({"items": invalid})
