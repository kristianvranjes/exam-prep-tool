import os

import pytest
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from community_helpers import review_question
from test_practice_database import bank as bank
from test_practice_database import clients as clients

from alembic import command
from app.database import Base, engine

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

NUMERIC = {
    "type": "NUMERIC",
    "stem": "Gravitational acceleration at sea level, in m/s²?",
    "correct_value": "9,81",
    "absolute_tolerance": "0.05",
    "unit": "m/s²",
    "explanation": "About 9.81 m/s².",
}
SELECT = {
    "type": "MULTIPLE_SELECT",
    "stem": "Which numbers are prime?",
    "options": [
        {"text": "2", "is_correct": True},
        {"text": "3", "is_correct": True},
        {"text": "4", "is_correct": False},
    ],
}


def approve(owner, course, body):
    created = owner.post(f"/courses/{course}/questions", json=body)
    assert created.status_code == 201, created.text
    question = created.json()
    assert owner.post(f"/questions/{question['id']}/submit").status_code == 200
    assert review_question(owner, f"/questions/{question['id']}/approve").status_code == 200
    return question


def session_with(member, course, types):
    response = member.post(
        f"/courses/{course}/attempts", json={"count": len(types), "question_types": types}
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_authoring_visibility_practice_and_grading(bank):
    owner, member, _, course, _ = bank
    numeric = approve(owner, course, NUMERIC)
    assert (numeric["correct_value"], numeric["absolute_tolerance"], numeric["unit"]) == (
        "9.81",
        "0.05",
        "m/s²",
    )
    select = approve(owner, course, SELECT)
    assert [o["is_correct"] for o in select["options"]] == [True, True, False]
    public = member.get(f"/questions/{numeric['id']}").json()
    assert public["visibility"] == "MEMBER" and public["unit"] == "m/s²"
    assert "correct_value" not in public and "absolute_tolerance" not in public

    attempt = session_with(member, course, ["NUMERIC", "MULTIPLE_SELECT"])
    path = f"/courses/{course}/attempts/{attempt['id']}"
    by_type = {q["type"]: q for q in attempt["questions"]}
    assert by_type["NUMERIC"]["unit"] == "m/s²"
    for question in attempt["questions"]:
        assert "correct_value" not in str(question.get("feedback"))
    numeric_q, select_q = by_type["NUMERIC"], by_type["MULTIPLE_SELECT"]
    bad = member.patch(
        f"{path}/answers/{numeric_q['id']}", json={"type": "NUMERIC", "value": "1.234,5"}
    )
    assert bad.status_code == 422
    out_of_range = {"type": "MULTIPLE_SELECT", "option_positions": [0, 4]}
    assert member.patch(f"{path}/answers/{select_q['id']}", json=out_of_range).status_code == 422
    assert (
        member.patch(
            f"{path}/answers/{numeric_q['id']}", json={"type": "NUMERIC", "value": "9,85"}
        ).status_code
        == 200
    )
    saved = member.patch(
        f"{path}/answers/{select_q['id']}",
        json={"type": "MULTIPLE_SELECT", "option_positions": [1, 0]},
    )
    assert saved.status_code == 200
    answered = {q["id"]: q["answer"] for q in saved.json()["questions"]}
    assert answered[select_q["id"]] == {"type": "MULTIPLE_SELECT", "option_positions": [0, 1]}
    result = member.post(path + "/submit").json()
    graded = {q["type"]: q for q in result["questions"]}
    assert graded["NUMERIC"]["grading_status"] == "CORRECT"
    assert (graded["NUMERIC"]["correct_value"], graded["NUMERIC"]["absolute_tolerance"]) == (
        "9.81",
        "0.05",
    )
    assert graded["MULTIPLE_SELECT"]["grading_status"] == "CORRECT"
    progress = member.get(f"/courses/{course}/review-progress").json()
    assert {row["question_id"] for row in progress} >= {numeric["id"], select["id"]}

    retry = session_with(member, course, ["MULTIPLE_SELECT"])
    retry_path = f"/courses/{course}/attempts/{retry['id']}"
    question = retry["questions"][0]
    member.patch(
        f"{retry_path}/answers/{question['id']}",
        json={"type": "MULTIPLE_SELECT", "option_positions": [0]},
    )
    assert member.post(retry_path + "/submit").json()["questions"][0]["grading_status"] == (
        "INCORRECT"
    )


def test_editing_suggestions_and_import(bank):
    owner, member, _, course, _ = bank
    draft = owner.post(f"/courses/{course}/questions", json=NUMERIC).json()
    edited = owner.patch(
        f"/questions/{draft['id']}", json={"relative_tolerance": "0.01", "absolute_tolerance": None}
    )
    assert edited.status_code == 200, edited.text
    assert (edited.json()["relative_tolerance"], edited.json()["absolute_tolerance"]) == (
        "0.01",
        None,
    )
    assert owner.patch(f"/questions/{draft['id']}", json={"correct_value": "x"}).status_code == 422

    select = approve(owner, course, SELECT | {"stem": "Which are even?"})
    proposal = {"changes": {"correct_option_positions": [0, 2]}}
    created = member.post(f"/questions/{select['id']}/suggestions", json=proposal)
    assert created.status_code == 201, created.text
    applied = owner.post(f"/question-suggestions/{created.json()['id']}/approve")
    assert applied.status_code == 200, applied.text
    current = owner.get(f"/questions/{select['id']}").json()
    assert [o["is_correct"] for o in current["options"]] == [True, False, True]
    numeric = approve(owner, course, NUMERIC | {"stem": "g in m/s²?"})
    wrong_field = {"changes": {"correct_answer": True}}
    assert (
        member.post(f"/questions/{numeric['id']}/suggestions", json=wrong_field).status_code == 422
    )
    fix = member.post(
        f"/questions/{numeric['id']}/suggestions", json={"changes": {"correct_value": "9.807"}}
    )
    assert fix.status_code == 201, fix.text

    document = {
        "version": "quiz-import-v2",
        "questions": [NUMERIC | {"stem": "Imported g?"}, SELECT | {"stem": "Imported primes?"}],
    }
    imported = owner.post(f"/courses/{course}/questions/import", json=document)
    assert imported.status_code in (200, 201), imported.text
    assert {q["type"] for q in imported.json()} == {"NUMERIC", "MULTIPLE_SELECT"}
    old = {"version": "quiz-import-v1", "questions": [NUMERIC | {"stem": "Old format g?"}]}
    assert owner.post(f"/courses/{course}/questions/import", json=old).status_code == 422


def test_papers_score_new_types_and_downgrade_guard(bank):
    owner, member, _, course, _ = bank
    select = approve(owner, course, SELECT)
    paper = owner.post(
        f"/courses/{course}/exam-papers",
        json={
            "academic_year": "2025/26",
            "kind": "QUIZ",
            "title": "Blic",
            "wrong_answer_penalty": 0.5,
        },
    ).json()
    path = f"/exam-papers/{paper['id']}"
    owner.post(path + "/items", json={"items": [{"question_id": select["id"], "points": 2}]})
    assert owner.post(path + "/publish").status_code == 200
    attempt = member.post(path + "/attempts", json={}).json()
    session = f"/courses/{course}/attempts/{attempt['id']}"
    question = attempt["questions"][0]
    member.patch(
        f"{session}/answers/{question['id']}",
        json={"type": "MULTIPLE_SELECT", "option_positions": [0]},
    )
    submitted = member.post(session + "/submit").json()
    # Right but incomplete: half the item's 2 points and no penalty.
    assert submitted["questions"][0]["score_fraction"] == 0.5
    assert submitted["questions"][0]["earned_points"] == 1
    score = submitted["score"]
    assert score["version"] == "paper-scoring-v2"
    assert (score["earned"], score["penalty_points"]) == (1, 0)

    # A wrong option marked is wrong, even beside a right one: it pays the penalty.
    wrong = member.post(path + "/attempts", json={}).json()
    wrong_session = f"/courses/{course}/attempts/{wrong['id']}"
    member.patch(
        f"{wrong_session}/answers/{wrong['questions'][0]['id']}",
        json={"type": "MULTIPLE_SELECT", "option_positions": [0, 2]},
    )
    result = member.post(wrong_session + "/submit").json()
    assert result["questions"][0]["score_fraction"] == 0
    assert (result["score"]["earned"], result["score"]["penalty_points"]) == (-1, 1)
    # The list's best result is the better of the two attempts.
    papers = member.get(f"/courses/{course}/exam-papers").json()["papers"]
    assert papers[0]["best"] == {"earned": 1, "max_points": 2}
    config = Config("alembic.ini")
    try:
        with pytest.raises(RuntimeError, match="numeric or multiple-select"):
            command.downgrade(config, "0023")
    finally:
        command.upgrade(config, "head")


def test_model_migration_parity():
    with engine.begin() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "compare_server_default": True,
                "include_object": lambda obj, name, type_, reflected, compare_to: (
                    type_ != "table" or name == "questions"
                ),
            },
        )
        assert compare_metadata(context, Base.metadata) == []
