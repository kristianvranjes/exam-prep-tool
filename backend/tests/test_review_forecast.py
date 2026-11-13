import os
from datetime import timedelta

import pytest
from test_materials import clients as clients
from test_practice_database import bank as bank
from test_practice_database import start

from app.services.course_summaries import zagreb_today

db_only = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def forecast(client, course, **params):
    return client.get(f"/courses/{course}/review-progress/forecast", params=params)


def answer_true_false(member, course):
    attempt = start(member, course, 1, question_types=["TRUE_FALSE"])
    path = f"/courses/{course}/attempts/{attempt['id']}"
    question = attempt["questions"][0]["id"]
    saved = member.patch(f"{path}/answers/{question}", json={"type": "TRUE_FALSE", "value": False})
    assert saved.status_code == 200, saved.text
    assert member.post(path + "/submit").status_code == 200


@db_only
def test_a_course_nobody_practised_has_a_flat_forecast(bank):
    _, member, _, course, _ = bank
    data = forecast(member, course).json()
    assert len(data["days"]) == 14
    assert data["days"][0]["date"] == zagreb_today().isoformat()
    assert sum(day["count"] for day in data["days"]) == 0


@db_only
def test_a_card_due_soon_counts_on_the_first_day(bank):
    _, member, _, course, _ = bank
    answer_true_false(member, course)
    days = forecast(member, course, days=7).json()["days"]
    assert len(days) == 7
    assert days[1]["date"] == (zagreb_today() + timedelta(days=1)).isoformat()
    # A graded answer is due within a day, so the one card sits on today or tomorrow.
    assert sum(day["count"] for day in days) == 1
    assert days[0]["count"] + days[1]["count"] == 1


@db_only
def test_the_forecast_is_private_and_bounded(bank):
    _, member, stranger, course, _ = bank
    assert forecast(stranger, course).status_code == 404
    assert forecast(member, course, days=0).status_code == 422
    assert forecast(member, course, days=61).status_code == 422
