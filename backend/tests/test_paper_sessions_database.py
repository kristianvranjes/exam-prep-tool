import os
from decimal import Decimal

import pytest
from community_helpers import provision
from fastapi.testclient import TestClient
from test_exam_papers_database import create
from test_practice_database import assert_no_keys, payload
from test_practice_database import bank as bank
from test_practice_database import clients as clients

from app.main import app

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

POINTS = (2, 1, 3)


def published(owner, course, rows, **changes):
    paper = create(owner, course, **changes)
    path = f"/exam-papers/{paper['id']}"
    body = {
        "items": [
            {"question_id": row["id"], "points": points, "label": f"Zadatak {index + 1}"}
            for index, (row, points) in enumerate(zip(rows, POINTS, strict=True))
        ]
    }
    assert owner.post(path + "/items", json=body).status_code == 200
    assert owner.post(path + "/publish").status_code == 200
    return paper, path


def take(client, path, **body):
    response = client.post(path + "/attempts", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_paper_session_freezes_order_points_and_rule(bank):
    owner, member, stranger, course, rows = bank
    paper, path = published(owner, course, rows)
    attempt = take(member, path)
    assert_no_keys(attempt)
    assert attempt["feedback_mode"] == "END" and attempt["focus_label"] == paper["title"]
    assert attempt["paper"] == {
        "exam_paper_id": paper["id"],
        "title": paper["title"],
        "total_points": 6,
        "wrong_answer_penalty": 0.25,
        "pass_threshold": 4,
        "duration_minutes": 90,
    }
    assert [q["stem"] for q in attempt["questions"]] == [row["stem"] for row in rows]
    assert [(q["points"], q["label"]) for q in attempt["questions"]] == [
        (2, "Zadatak 1"),
        (1, "Zadatak 2"),
        (3, "Zadatak 3"),
    ]
    history = member.get(f"/courses/{course}/attempts").json()
    assert history[0]["paper"]["title"] == paper["title"]
    assert stranger.post(path + "/attempts", json={}).status_code == 404
    # Later paper edits and even deletion leave the session as it started.
    assert owner.post(path + "/unpublish").status_code == 200
    assert member.post(path + "/attempts", json={}).status_code == 404
    assert owner.post(path + "/attempts", json={}).status_code == 409
    owner.post(path + "/items", json={"items": [{"question_id": rows[0]["id"], "points": 9}]})
    assert owner.delete(path).status_code == 204
    reread = member.get(f"/courses/{course}/attempts/{attempt['id']}").json()
    assert reread["paper"] == attempt["paper"] | {"exam_paper_id": None}
    assert reread["questions"] == attempt["questions"]


def test_blanks_negative_marking_and_scheduling(bank):
    owner, member, _, course, rows = bank
    _, path = published(owner, course, rows)
    attempt = take(member, path)
    session = f"/courses/{course}/attempts/{attempt['id']}"
    objective = [q for q in attempt["questions"] if q["type"] != "SHORT_ANSWER"]
    blank = next(q for q in attempt["questions"] if q["type"] == "SHORT_ANSWER")
    for question in attempt["questions"]:
        assert (
            member.patch(f"{session}/answers/{question['id']}", json=payload(question)).status_code
            == 200
        )
    # Clearing leaves the question blank again; repeats are harmless.
    cleared = member.delete(f"{session}/answers/{blank['id']}")
    assert cleared.status_code == 200
    assert next(q for q in cleared.json()["questions"] if q["id"] == blank["id"])["answer"] is None
    assert member.delete(f"{session}/answers/{blank['id']}").status_code == 200
    result = member.post(session + "/submit")
    assert result.status_code == 200, result.text
    result = result.json()
    by_id = {q["id"]: q for q in result["questions"]}
    assert by_id[blank["id"]]["grading_status"] == "UNANSWERED"
    assert by_id[blank["id"]]["earned_points"] == 0
    expected = Decimal(0)
    for question in objective:
        graded = by_id[question["id"]]
        value = Decimal(str(question["points"]))
        delta = value if graded["grading_status"] == "CORRECT" else -value * Decimal("0.25")
        assert Decimal(str(graded["earned_points"])) == delta
        expected += delta
    score = result["score"]
    assert score["version"] == "paper-scoring-v1"
    assert Decimal(str(score["earned"])) == expected
    assert (score["max_points"], score["pending_points"], score["unanswered_count"]) == (6, 0, 1)
    assert score["passed"] is (expected >= 4)
    progress = member.get(f"/courses/{course}/review-progress").json()
    assert {row["question_id"] for row in progress} == {
        row["id"] for row in rows if row["type"] != "SHORT_ANSWER"
    }
    assert member.delete(f"{session}/answers/{blank['id']}").status_code == 409


def test_ordinary_practice_still_needs_an_answer_and_checked_answers_stay(bank):
    owner, member, _, course, rows = bank
    _, path = published(owner, course, rows)
    attempt = take(member, path, feedback_mode="IMMEDIATE")
    session = f"/courses/{course}/attempts/{attempt['id']}"
    first = attempt["questions"][0]
    member.patch(f"{session}/answers/{first['id']}", json=payload(first))
    assert member.post(f"{session}/answers/{first['id']}/check", json={}).status_code == 200
    assert member.delete(f"{session}/answers/{first['id']}").status_code == 409
    practice = member.post(f"/courses/{course}/attempts", json={"count": 1}).json()
    assert practice["paper"] is None
    assert member.post(f"/courses/{course}/attempts/{practice['id']}/submit").status_code == 409


def test_only_enrolled_members_take_papers(bank):
    owner, _, _, course, rows = bank
    _, path = published(owner, course, rows)
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    with TestClient(app) as moderator:
        moderator.post(
            "/auth/register",
            json={
                "email": "paper-taker@example.com",
                "password": "correct horse",
                "display_name": "Moderator",
            },
        )
        provision(moderator, faculty)
        # Moderators manage papers without enrolling, but practice belongs to members.
        assert moderator.get(path).status_code == 200
        assert moderator.post(path + "/attempts", json={}).status_code == 404
    assert take(owner, path)["paper"]["total_points"] == 6
