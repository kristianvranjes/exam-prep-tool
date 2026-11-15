"""Ratings given during a session (0031) and the maturity of a course's decks."""

import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from alembic.config import Config
from sqlalchemy import text, update
from test_exam_scopes_database import draft, unit
from test_materials import clients as clients
from test_practice_modes_database import add_progress
from test_srs_ratings import card

from alembic import command
from app.database import SessionLocal, engine
from app.models.user_question_progress import UserQuestionProgress

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

DAY = 24 * 60


def immediate_session(client, course, count=1):
    body = {"count": count, "question_types": ["TRUE_FALSE"], "feedback_mode": "IMMEDIATE"}
    response = client.post(f"/courses/{course}/attempts", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def answer_and_check(client, course, attempt, value):
    path = f"/courses/{course}/attempts/{attempt['id']}"
    for question in attempt["questions"]:
        body = {"type": "TRUE_FALSE", "value": value}
        assert client.patch(f"{path}/answers/{question['id']}", json=body).status_code == 200
        assert client.post(f"{path}/answers/{question['id']}/check", json={}).status_code == 200
    return path


def rate(client, path, question, rating):
    return client.put(f"{path}/answers/{question['id']}/rating", json={"rating": rating})


def events(question_id):
    with engine.connect() as conn:
        return [
            tuple(row)
            for row in conn.execute(
                text(
                    "SELECT rating, interval_minutes FROM review_rating_events"
                    " WHERE question_id = :id ORDER BY rated_at"
                ),
                {"id": question_id},
            )
        ]


def stocked(clients, questions):
    owner, member, _, course = clients
    first = unit(owner, course, "Unit 1")
    second = unit(owner, course, "Unit 2")
    ids = []
    for number in range(questions):
        units = [first] if number < questions - 2 else [first, second]
        ids.append(draft(member, course, f"Q{number}?", units))
    return member, course, ids, first, second


def test_a_rating_given_in_the_session_schedules_the_card_once_at_submission(clients):
    member, course, *_ = stocked(clients, 3)
    attempt = immediate_session(member, course)
    question = attempt["questions"][0]
    source = question["source_question_id"]
    path = answer_and_check(member, course, attempt, True)

    shown = rate(member, path, question, "HARD")
    assert shown.status_code == 200, shown.text
    assert shown.json()["questions"][0]["rating"] == "HARD"
    # Nothing is scheduled before the session is submitted.
    with engine.connect() as conn:
        assert not conn.scalar(
            text("SELECT count(*) FROM question_review_progress WHERE question_id = :id"),
            {"id": source},
        )

    submitted = member.post(path + "/submit").json()
    assert submitted["questions"][0]["rating"] == "HARD"
    row = card(source)
    assert row["scheduling_version"] == "srs-v2" and row["last_rating"] == "HARD"
    # One reschedule from the rating alone: a one-day gap grown by 1.2, not the graded answer's
    # delay and then the rating's on top of it.
    assert (row["interval_minutes"], row["repetitions"], row["lapses"]) == (1728, 1, 0)
    assert row["resolved_review_count"] == 1
    assert events(source) == [("HARD", 1728)]


def test_a_rated_card_already_on_srs_v2_is_not_rescheduled_by_its_graded_answer_too(clients):
    member, course, *_ = stocked(clients, 1)
    first = immediate_session(member, course)
    source = first["questions"][0]["source_question_id"]
    path = answer_and_check(member, course, first, True)
    rate(member, path, first["questions"][0], "GOOD")
    member.post(path + "/submit")
    gap = card(source)["interval_minutes"]
    assert gap == 3600

    with SessionLocal() as db:  # the card is due again
        db.execute(
            update(UserQuestionProgress)
            .where(UserQuestionProgress.question_id == UUID(source))
            .values(due_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        db.commit()
    second = immediate_session(member, course)
    path = answer_and_check(member, course, second, True)
    rate(member, path, second["questions"][0], "EASY")
    member.post(path + "/submit")
    # Grown once, by the explicit EASY (x3.3), instead of by an automatic GOOD (x2.5) first.
    assert card(source)["interval_minutes"] == round(gap * 3.3)
    assert [event[0] for event in events(source)] == ["GOOD", "EASY"]


def test_without_a_rating_submission_schedules_as_before(clients):
    member, course, *_ = stocked(clients, 1)
    attempt = immediate_session(member, course)
    source = attempt["questions"][0]["source_question_id"]
    path = answer_and_check(member, course, attempt, True)
    assert member.post(path + "/submit").status_code == 200
    row = card(source)
    assert row["scheduling_version"] == "leitner-v1" and row["last_rating"] is None
    assert events(source) == []


def test_a_rating_needs_a_checked_answer_can_be_taken_back_and_freezes_with_the_session(clients):
    member, course, *_ = stocked(clients, 2)
    attempt = immediate_session(member, course)
    question = attempt["questions"][0]
    path = f"/courses/{course}/attempts/{attempt['id']}"
    assert rate(member, path, question, "GOOD").status_code == 409  # not answered
    member.patch(f"{path}/answers/{question['id']}", json={"type": "TRUE_FALSE", "value": True})
    assert rate(member, path, question, "GOOD").status_code == 409  # not checked
    member.post(f"{path}/answers/{question['id']}/check", json={})
    assert rate(member, path, question, "MAYBE").status_code == 422
    assert rate(member, path, question, "GOOD").json()["questions"][0]["rating"] == "GOOD"
    taken_back = rate(member, path, question, None)
    assert taken_back.json()["questions"][0]["rating"] is None

    rate(member, path, question, "EASY")
    member.post(path + "/submit")
    assert rate(member, path, question, "AGAIN").status_code == 409
    # Other people's sessions are not reachable.
    assert rate(clients[2], path, question, "GOOD").status_code == 404


def test_decks_count_new_learning_and_mature_questions_per_unit(clients):
    member, course, ids, first, second = stocked(clients, 6)
    # ids[4] and ids[5] are in both units; ids[0..3] only in the first.
    now = datetime.now(UTC)
    add_progress(member, ids[0], now - timedelta(hours=1))  # leitner, stage 1: one day, due
    add_progress(member, ids[1], now + timedelta(days=2))  # learning, not due
    add_progress(member, ids[4], now - timedelta(minutes=5))  # shared, becomes mature and due
    user_id = UUID(member.get("/auth/me").json()["id"])
    with SessionLocal() as db:
        db.execute(
            update(UserQuestionProgress)
            .where(
                UserQuestionProgress.user_id == user_id,
                UserQuestionProgress.question_id == UUID(ids[4]),
            )
            .values(interval_minutes=21 * DAY, scheduling_version="srs-v2")
        )
        db.commit()

    response = member.get(f"/courses/{course}/review-progress/decks")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mature_after_days"] == 21
    decks = {deck["unit_id"]: deck for deck in body["decks"]}
    assert [deck["unit_id"] for deck in body["decks"]] == [first, second]
    keys = ("new", "learning", "mature", "due")
    # Unit 1 holds all six questions; unit 2 only the two shared ones.
    assert decks[first]["title"] == "Unit 1"
    assert {k: decks[first][k] for k in keys} == {"new": 3, "learning": 2, "mature": 1, "due": 2}
    assert {k: decks[second][k] for k in keys} == {"new": 1, "learning": 0, "mature": 1, "due": 1}
    # A question in two units counts once in the total.
    assert body["total"] == {"new": 3, "learning": 2, "mature": 1, "due": 2}


def test_a_gap_just_under_21_days_is_still_learning_and_an_archived_unit_has_no_deck(clients):
    owner, *_ = clients
    member, course, ids, first, second = stocked(clients, 3)
    add_progress(member, ids[0], datetime.now(UTC) + timedelta(days=1))
    user_id = UUID(member.get("/auth/me").json()["id"])
    with SessionLocal() as db:
        db.execute(
            update(UserQuestionProgress)
            .where(UserQuestionProgress.user_id == user_id)
            .values(interval_minutes=21 * DAY - 1)
        )
        db.commit()
    archived = owner.post(f"/units/{second}/archive")
    assert archived.status_code == 200, archived.text
    body = member.get(f"/courses/{course}/review-progress/decks").json()
    assert [deck["unit_id"] for deck in body["decks"]] == [first]
    assert body["total"] == {"new": 2, "learning": 1, "mature": 0, "due": 0}


def test_0031_roundtrip_drops_only_the_pending_rating(clients):
    member, course, *_ = stocked(clients, 2)
    attempt = immediate_session(member, course)
    path = answer_and_check(member, course, attempt, True)
    question = attempt["questions"][0]
    rate(member, path, question, "GOOD")
    config = Config("alembic.ini")

    def has_rating_column():
        with engine.connect() as conn:
            return bool(
                conn.scalar(
                    text(
                        "SELECT count(*) FROM information_schema.columns WHERE"
                        " table_schema = current_schema() AND table_name = 'answers'"
                        " AND column_name = 'rating'"
                    )
                )
            )

    try:
        for _ in range(2):
            command.downgrade(config, "0030")
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0030"
            assert not has_rating_column()
            command.upgrade(config, "head")
            assert has_rating_column()
            # The session and its checked answer survive; only the rating is gone.
            reread = member.get(path).json()
            assert reread["status"] == "ACTIVE" and reread["questions"][0]["rating"] is None
            assert rate(member, path, question, "GOOD").status_code == 200
    finally:
        command.upgrade(config, "head")
