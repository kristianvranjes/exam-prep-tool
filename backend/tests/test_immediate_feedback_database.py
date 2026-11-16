import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from test_practice_database import assert_no_keys, payload, save_all, start
from test_practice_database import bank as bank
from test_practice_database import clients as clients

from app.database import engine
from app.main import app

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def progress(client, course):
    response = client.get(f"/courses/{course}/review-progress")
    assert response.status_code == 200, response.text
    return response.json()


def check(client, path, question, **body):
    return client.post(f"{path}/answers/{question['id']}/check", json=body)


def test_check_reveals_only_that_question_and_freezes_it(bank):
    _, member, _, course, _ = bank
    attempt = start(member, course, feedback_mode="IMMEDIATE")
    assert attempt["feedback_mode"] == "IMMEDIATE"
    path = save_all(member, course, attempt)
    first, *rest = attempt["questions"]
    assert check(member, path, first, confidence="GUESS").status_code == 200
    checked = member.get(path).json()
    assert checked["status"] == "ACTIVE"
    shown, *hidden = checked["questions"]
    assert shown["feedback"]["confidence"] == "GUESS"
    assert shown["feedback"]["grading_status"] in {"CORRECT", "INCORRECT", "PENDING"}
    assert {"options", "explanation", "correct_boolean", "reference_answer"} <= shown[
        "feedback"
    ].keys()
    assert_no_keys(hidden)
    # Repeats keep the first decision; the answer can no longer change.
    repeat = check(member, path, first, confidence="SURE")
    assert repeat.status_code == 200
    assert repeat.json()["questions"][0]["feedback"] == shown["feedback"]
    assert member.patch(f"{path}/answers/{first['id']}", json=payload(first)).status_code == 409
    assert member.patch(f"{path}/answers/{rest[0]['id']}", json=payload(rest[0])).status_code == 200


def test_check_requires_immediate_mode_and_saved_answer(bank):
    _, member, _, course, _ = bank
    end = start(member, course)
    assert end["feedback_mode"] == "END"
    path = save_all(member, course, end)
    response = check(member, path, end["questions"][0])
    assert response.status_code == 409
    assert_no_keys(member.get(path).json())
    immediate = start(member, course, feedback_mode="IMMEDIATE")
    path = f"/courses/{course}/attempts/{immediate['id']}"
    assert check(member, path, immediate["questions"][0]).status_code == 409
    assert check(member, path, {"id": end["questions"][0]["id"]}).status_code == 404
    assert check(member, path, immediate["questions"][0], confidence="NO").status_code == 422


def test_check_authorization(bank):
    owner, member, stranger, course, _ = bank
    attempt = start(member, course, feedback_mode="IMMEDIATE")
    path = save_all(member, course, attempt)
    question = attempt["questions"][0]
    for client in (owner, stranger):
        assert check(client, path, question).status_code == 404
    with TestClient(app) as anonymous:
        assert check(anonymous, path, question).status_code == 401
    assert_no_keys(member.get(path).json())


def test_submit_keeps_checked_grades_and_schedules_once(bank):
    _, member, _, course, _ = bank
    attempt = start(member, course, feedback_mode="IMMEDIATE")
    path = save_all(member, course, attempt)
    checked = [
        check(member, path, q).json()["questions"][q["position"]]["feedback"]
        for q in attempt["questions"]
    ]
    assert progress(member, course) == []
    # A checked grade is final even if the frozen key were somehow different.
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE answers SET grading_status = 'INCORRECT' "
                "WHERE grading_method = 'DETERMINISTIC'"
            )
        )
    result = member.post(path + "/submit").json()
    assert result["status"] == "SUBMITTED"
    for question, seen in zip(result["questions"], checked, strict=True):
        expected = "PENDING" if seen["grading_status"] == "PENDING" else "INCORRECT"
        assert question["grading_status"] == expected
        assert question["feedback"] is None
    rows = progress(member, course)
    objective = [q for q in result["questions"] if q["type"] != "SHORT_ANSWER"]
    assert len(rows) == len(objective)
    assert {row["last_result"] for row in rows} == {"INCORRECT"}


def test_abandon_after_check_keeps_feedback_without_progress(bank):
    _, member, _, course, _ = bank
    attempt = start(member, course, feedback_mode="IMMEDIATE")
    path = save_all(member, course, attempt)
    first = attempt["questions"][0]
    seen = check(member, path, first).json()["questions"][0]["feedback"]
    abandoned = member.post(path + "/abandon").json()
    assert abandoned["status"] == "ABANDONED"
    assert abandoned["questions"][0]["feedback"] == seen
    assert_no_keys(abandoned["questions"][1:])
    assert progress(member, course) == []
    assert check(member, path, attempt["questions"][1]).status_code == 409
