import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import text
from test_paper_sessions_database import published, take
from test_practice_database import bank as bank
from test_practice_database import clients as clients
from test_practice_database import payload

from app.database import engine

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def expire(attempt_id: str) -> None:
    # Move the window into the past instead of waiting for it.
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE quiz_attempts SET started_at = now() - interval '2 hours', "
                "deadline_at = now() - interval '1 second' WHERE id = :id"
            ),
            {"id": UUID(attempt_id)},
        )


def test_timed_paper_sets_a_server_deadline_that_survives_reads(bank):
    owner, member, _, course, rows = bank
    _, path = published(owner, course, rows)
    attempt = take(member, path)
    started = datetime.fromisoformat(attempt["started_at"])
    deadline = datetime.fromisoformat(attempt["deadline_at"])
    assert deadline - started == timedelta(minutes=90)
    server_time = datetime.fromisoformat(attempt["server_time"])
    assert abs(server_time - datetime.now(UTC)) < timedelta(minutes=1)
    session = f"/courses/{course}/attempts/{attempt['id']}"
    assert member.get(session).json()["deadline_at"] == attempt["deadline_at"]
    history = member.get(f"/courses/{course}/attempts").json()
    assert history[0]["deadline_at"] == attempt["deadline_at"]
    untimed = take(member, path, timed=False)
    assert untimed["deadline_at"] is None
    practice = member.post(f"/courses/{course}/attempts", json={"count": 1}).json()
    assert practice["deadline_at"] is None


def test_paper_without_a_time_limit_is_never_timed(bank):
    owner, member, _, course, rows = bank
    _, path = published(owner, course, rows, duration_minutes=None)
    assert take(member, path)["deadline_at"] is None


def test_after_the_deadline_answers_freeze_but_hand_in_works(bank):
    owner, member, _, course, rows = bank
    _, path = published(owner, course, rows)
    attempt = take(member, path, feedback_mode="IMMEDIATE")
    session = f"/courses/{course}/attempts/{attempt['id']}"
    first, second, *_ = attempt["questions"]
    assert member.patch(f"{session}/answers/{first['id']}", json=payload(first)).status_code == 200
    expire(attempt["id"])
    late = member.patch(f"{session}/answers/{second['id']}", json=payload(second))
    assert late.status_code == 409 and "Time is up" in late.text
    assert member.delete(f"{session}/answers/{first['id']}").status_code == 409
    assert member.post(f"{session}/answers/{first['id']}/check", json={}).status_code == 409
    # Reading still works, so a refreshed page can show the hand-in screen.
    assert member.get(session).json()["status"] == "ACTIVE"
    result = member.post(session + "/submit")
    assert result.status_code == 200, result.text
    by_id = {q["id"]: q for q in result.json()["questions"]}
    assert by_id[first["id"]]["answer"] == payload(first)
    assert by_id[second["id"]]["grading_status"] == "UNANSWERED"
    assert member.post(session + "/submit").json() == result.json()


def test_abandoning_an_expired_session_still_works(bank):
    owner, member, _, course, rows = bank
    _, path = published(owner, course, rows)
    attempt = take(member, path)
    expire(attempt["id"])
    session = f"/courses/{course}/attempts/{attempt['id']}"
    assert member.post(session + "/abandon").json()["status"] == "ABANDONED"
