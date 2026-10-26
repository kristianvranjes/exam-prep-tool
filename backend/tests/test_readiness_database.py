import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from community_helpers import provision, review_question
from fastapi.testclient import TestClient
from test_exam_scopes_database import draft, scope, unit
from test_materials import clients as clients

from app.database import SessionLocal
from app.main import app
from app.models.user_question_progress import UserQuestionProgress
from app.services import readiness
from app.services.readiness import wilson

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

BODY = {"academic_year": "2026/27", "kind": "MIDTERM", "name": "Međuispit"}


def approve(owner, course, ids):
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    for id_ in ids:
        assert owner.post(f"/questions/{id_}/submit").status_code == 200
    with TestClient(app) as reviewer:
        response = reviewer.post(
            "/auth/register",
            json={
                "email": f"reviewer-{uuid4().hex}@example.com",
                "password": "correct horse",
                "display_name": "Reviewer",
            },
        )
        assert response.status_code == 201
        provision(reviewer, faculty)
        for id_ in ids:
            assert reviewer.post(f"/questions/{id_}/approve").status_code == 200


def approved(owner, course, title, unit_id, count):
    ids = [draft(owner, course, f"{title} {n}", [unit_id]) for n in range(count)]
    approve(owner, course, ids)
    return ids


def record(client, question_id, stage, result, due, answers=1, correct=None):
    """Store review progress directly, so stages and due dates are exact."""
    user_id = UUID(client.get("/auth/me").json()["id"])
    now = datetime.now(UTC)
    correct = answers if correct is None else correct
    with SessionLocal() as db:
        db.add(
            UserQuestionProgress(
                user_id=user_id,
                question_id=UUID(question_id),
                review_stage=stage,
                resolved_review_count=answers,
                correct_review_count=correct,
                incorrect_review_count=answers - correct,
                last_result=result,
                last_reviewed_at=now,
                due_at=now + due,
                scheduling_version="leitner-v1",
                created_at=now,
                updated_at=now,
            )
        )
        db.commit()


def get(client, scope_id):
    response = client.get(f"/exam-scopes/{scope_id}/readiness")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def cycle(clients):
    owner, member, stranger, course = clients
    logic, sets, relations, outside = (
        unit(owner, course, title) for title in ("Logika", "Skupovi", "Relacije", "Izvan")
    )
    questions = {
        "logic": approved(owner, course, "Logika", logic, 4),
        "sets": approved(owner, course, "Skupovi", sets, 4),
        "relations": approved(owner, course, "Relacije", relations, 2),
        "outside": approved(owner, course, "Izvan", outside, 1),
    }
    mi = scope(owner, course, **BODY, unit_ids=[logic, sets, relations])
    units = {"logic": logic, "sets": sets, "relations": relations}
    return owner, member, stranger, course, mi["id"], units, questions


def test_readiness_counts_coverage_accuracy_retention_and_orders_weak_units(cycle, monkeypatch):
    owner, member, stranger, course, mi, units, questions = cycle
    logic, sets = questions["logic"], questions["sets"]
    day = timedelta(days=1)
    record(member, logic[0], 2, "CORRECT", 2 * day, answers=2)
    record(member, logic[1], 1, "CORRECT", day / 2)
    record(member, logic[2], 0, "INCORRECT", timedelta(minutes=5), answers=2, correct=1)
    # Correct once, but overdue for longer than its one-day interval.
    record(member, sets[0], 1, "CORRECT", -3 * day)

    data = get(member, mi)
    assert data["rule"] == "readiness-v1"
    totals = {key: data[key] for key in ("question_count", "answered_count", "retained_count")}
    assert totals == {"question_count": 10, "answered_count": 4, "retained_count": 2}
    assert (data["answer_count"], data["correct_answer_count"]) == (6, 5)
    # Four answered questions are not enough for a range.
    assert (data["min_answered"], data["readiness"]) == (10, None)

    by_unit = {row["unit_id"]: row for row in data["units"]}
    assert [row["unit_id"] for row in data["units"]] == list(units.values())
    first = by_unit[units["logic"]]
    assert first["title"] == "Logika"
    assert {key: first[key] for key in ("question_count", "answered_count", "retained_count")} == {
        "question_count": 4,
        "answered_count": 3,
        "retained_count": 2,
    }
    assert (first["answer_count"], first["correct_answer_count"]) == (5, 4)
    assert (first["coverage"], first["accuracy"], first["retention"]) == (0.75, 0.8, 0.6667)
    lower, upper = wilson(2, 3)
    assert first["readiness"]["low"] == pytest.approx((2 + lower) / 4, abs=1e-4)
    assert first["readiness"]["high"] == pytest.approx((2 + upper) / 4, abs=1e-4)
    second = by_unit[units["sets"]]
    assert (second["coverage"], second["accuracy"], second["retention"]) == (0.25, 1.0, 0.0)
    untouched = by_unit[units["relations"]]
    assert (untouched["coverage"], untouched["accuracy"], untouched["retention"]) == (
        0.0,
        None,
        None,
    )
    assert untouched["readiness"] == {"low": 0.0, "high": 1.0}
    # A unit with a weak answer ranks below an untouched one; the strongest comes last.
    assert data["weakest_unit_ids"] == [units["sets"], units["relations"], units["logic"]]

    monkeypatch.setattr(readiness, "MIN_ANSWERED", 3)
    ranged = get(member, mi)
    assert ranged["min_answered"] == 3
    unanswered_sets = 3 * wilson(0, 1)[1]
    assert ranged["readiness"]["low"] == pytest.approx((2 + lower) / 10, abs=1e-4)
    assert ranged["readiness"]["high"] == pytest.approx(
        (2 + upper + unanswered_sets + 2) / 10, abs=1e-4
    )

    # Readiness is personal and members only.
    mine = get(owner, mi)
    assert (mine["answered_count"], mine["readiness"]) == (0, None)
    assert stranger.get(f"/exam-scopes/{mi}/readiness").status_code == 404
    assert member.get(f"/exam-scopes/{uuid4()}/readiness").status_code == 404


def test_readiness_ignores_unavailable_questions_and_other_users(cycle):
    owner, member, _, course, mi, units, questions = cycle
    day = timedelta(days=1)
    # Practised before it was archived: history stays, but it is no longer exam material.
    archived = questions["sets"][1]
    record(member, archived, 3, "CORRECT", day)
    assert review_question(owner, f"/questions/{archived}/archive").status_code == 200
    # A member's own draft can be practised, but it is not shared bank material.
    own = draft(member, course, "Moj nacrt", [units["logic"]])
    record(member, own, 1, "CORRECT", day)
    # Short answers are self-reviewed, so they never count towards readiness.
    short = owner.post(
        f"/courses/{course}/questions",
        json={
            "type": "SHORT_ANSWER",
            "stem": "Objasni De Morganove zakone",
            "reference_answer": "Negacija konjunkcije je disjunkcija negacija.",
            "unit_ids": [units["logic"]],
        },
    )
    assert short.status_code == 201, short.text
    approve(owner, course, [short.json()["id"]])
    # Questions outside the scope's units do not count.
    record(member, questions["outside"][0], 1, "CORRECT", day)
    # Someone else's progress never counts.
    for question_id in questions["relations"]:
        record(owner, question_id, 1, "CORRECT", day)

    data = get(member, mi)
    assert (data["question_count"], data["answered_count"], data["answer_count"]) == (9, 0, 0)
    assert all(row["answered_count"] == 0 for row in data["units"])
    counts = {row["unit_id"]: row["question_count"] for row in data["units"]}
    assert counts == {units["logic"]: 4, units["sets"]: 3, units["relations"]: 2}
    assert get(owner, mi)["units"][2]["retained_count"] == 2


def test_practice_updates_readiness_and_drops_a_fully_retained_unit(cycle, monkeypatch):
    _, member, _, course, mi, units, _ = cycle
    response = member.post(
        f"/courses/{course}/attempts",
        json={"count": 2, "question_types": ["TRUE_FALSE"], "unit_ids": [units["relations"]]},
    )
    assert response.status_code == 201, response.text
    attempt = response.json()
    path = f"/courses/{course}/attempts/{attempt['id']}"
    for question in attempt["questions"]:
        answer = {"type": "TRUE_FALSE", "value": True}
        assert member.patch(f"{path}/answers/{question['id']}", json=answer).status_code == 200
    assert member.post(f"{path}/submit").status_code == 200

    monkeypatch.setattr(readiness, "MIN_ANSWERED", 2)
    data = get(member, mi)
    relations = data["units"][2]
    assert (relations["coverage"], relations["accuracy"], relations["retention"]) == (1, 1, 1)
    assert relations["readiness"] == {"low": 1.0, "high": 1.0}
    assert units["relations"] not in data["weakest_unit_ids"]
    assert data["weakest_unit_ids"] == [units["logic"], units["sets"]]
    # Two retained questions of ten; the eight untouched ones could be anything.
    assert data["readiness"] == {"low": 0.2, "high": 1.0}
