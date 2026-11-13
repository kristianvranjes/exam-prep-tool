import os
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import select, text
from test_materials import clients as clients
from test_practice_database import bank as bank
from test_practice_database import start

from app.database import SessionLocal
from app.models.user_question_progress import ReviewRatingEvent
from app.services.scheduling import rating_for_result, schedule_rating

db_only = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

NOW = datetime(2026, 11, 13, 12, 0, tzinfo=UTC)
DAY = 24 * 60


def test_again_returns_in_ten_minutes_and_counts_a_lapse():
    rated = schedule_rating(4320, 3, 1, "AGAIN", NOW)
    assert (rated.interval_minutes, rated.repetitions, rated.lapses) == (10, 0, 2)
    assert rated.due_at == NOW + timedelta(minutes=10)
    assert rated.scheduling_version == "srs-v2"


@pytest.mark.parametrize(("rating", "minutes"), [("HARD", 1728), ("GOOD", 3600), ("EASY", 4752)])
def test_a_first_successful_review_grows_a_one_day_gap(rating, minutes):
    rated = schedule_rating(None, 0, 0, rating, NOW)
    assert rated.interval_minutes == minutes
    assert rated.due_at == NOW + timedelta(minutes=minutes)
    assert (rated.repetitions, rated.lapses) == (1, 0)


def test_the_gap_keeps_growing_from_the_previous_one():
    assert schedule_rating(7 * DAY, 3, 0, "GOOD", NOW).interval_minutes == 25200
    # A card just forgotten (10 minutes) restarts from one day, not from ten minutes.
    assert schedule_rating(10, 0, 1, "GOOD", NOW).interval_minutes == 3600


def test_the_gap_stops_at_a_year():
    assert schedule_rating(300 * DAY, 8, 0, "EASY", NOW).interval_minutes == 365 * DAY


def test_the_due_time_never_passes_the_start_of_the_exam_day():
    rated = schedule_rating(7 * DAY, 3, 0, "GOOD", NOW, exam_start=date(2026, 11, 15))
    # 15 November 00:00 in Zagreb (UTC+1) is 14 November 23:00 UTC.
    assert rated.due_at == datetime(2026, 11, 14, 23, 0, tzinfo=UTC)
    assert rated.interval_minutes == 25200  # the uncapped gap, so it grows after the exam


def test_an_exam_that_has_already_started_does_not_cap_the_gap():
    rated = schedule_rating(None, 0, 0, "GOOD", NOW, exam_start=date(2026, 11, 13))
    assert rated.due_at == NOW + timedelta(minutes=3600)


def test_a_graded_answer_counts_as_good_or_again():
    assert rating_for_result("CORRECT") == "GOOD"
    assert rating_for_result("INCORRECT") == "AGAIN"
    assert rating_for_result("PENDING") is None


def rate(client, course, question, rating):
    return client.post(
        f"/courses/{course}/review-progress/ratings",
        json={"question_id": question, "rating": rating},
    )


def true_false(rows):
    return next(row["id"] for row in rows if row["type"] == "TRUE_FALSE")


def answer_true_false(member, course):
    """Answers and submits a one-question session on the true/false question."""
    attempt = start(member, course, 1, question_types=["TRUE_FALSE"])
    path = f"/courses/{course}/attempts/{attempt['id']}"
    saved = member.patch(
        f"{path}/answers/{attempt['questions'][0]['id']}",
        json={"type": "TRUE_FALSE", "value": False},
    )
    assert saved.status_code == 200, saved.text
    assert member.post(path + "/submit").status_code == 200


def card(question_id):
    with SessionLocal() as db:
        return (
            db.execute(
                text(
                    "SELECT scheduling_version, review_stage, resolved_review_count,"
                    " last_result, interval_minutes, repetitions, lapses, last_rating, due_at"
                    " FROM question_review_progress WHERE question_id = :id"
                ),
                {"id": question_id},
            )
            .mappings()
            .one()
        )


@db_only
def test_a_card_can_only_be_rated_by_someone_who_answered_the_question(bank):
    _, member, stranger, course, rows = bank
    question = true_false(rows)
    assert rate(member, course, question, "GOOD").status_code == 404
    answer_true_false(member, course)
    assert rate(stranger, course, question, "GOOD").status_code == 404
    assert rate(member, course, question, "MAYBE").status_code == 422


@db_only
def test_a_rating_reschedules_the_card_without_touching_the_answer_counts(bank):
    _, member, _, course, rows = bank
    question = true_false(rows)
    answer_true_false(member, course)
    before = card(question)
    assert before["scheduling_version"] == "leitner-v1"
    response = rate(member, course, question, "EASY")
    assert response.status_code == 200, response.text
    data = response.json()
    assert (data["rating"], data["scheduling_version"]) == ("EASY", "srs-v2")
    assert data["repetitions"] == before["repetitions"] + 1
    after = card(question)
    assert after["scheduling_version"] == "srs-v2" and after["last_rating"] == "EASY"
    assert after["interval_minutes"] == data["interval_minutes"]
    assert after["due_at"] == datetime.fromisoformat(data["due_at"])
    # The answer counts, the stage and the last result are exactly as grading left them.
    for field in ("review_stage", "resolved_review_count", "last_result"):
        assert after[field] == before[field]
    with SessionLocal() as db:
        events = db.scalars(
            select(ReviewRatingEvent).where(ReviewRatingEvent.question_id == UUID(question))
        ).all()
    assert [(event.rating, event.interval_minutes) for event in events] == [
        ("EASY", data["interval_minutes"])
    ]


@db_only
def test_again_makes_the_card_due_in_ten_minutes_and_counts_a_lapse(bank):
    _, member, _, course, rows = bank
    question = true_false(rows)
    answer_true_false(member, course)
    lapses = card(question)["lapses"]
    data = rate(member, course, question, "AGAIN").json()
    assert (data["interval_minutes"], data["repetitions"], data["lapses"]) == (10, 0, lapses + 1)
    assert datetime.fromisoformat(data["due_at"]) - datetime.now(UTC) < timedelta(minutes=11)


@db_only
def test_a_graded_answer_keeps_a_rated_card_on_the_rating_schedule(bank):
    _, member, _, course, rows = bank
    question = true_false(rows)
    answer_true_false(member, course)
    rate(member, course, question, "GOOD")
    answer_true_false(member, course)
    after = card(question)
    assert after["scheduling_version"] == "srs-v2"
    assert after["last_rating"] in {"GOOD", "AGAIN"}
    assert after["interval_minutes"] is not None and after["interval_minutes"] > 0
