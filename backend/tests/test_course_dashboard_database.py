import os
from datetime import UTC, date, datetime, timedelta

import pytest
from test_exam_scopes_database import unit
from test_materials import clients as clients
from test_practice_database import bank as bank
from test_practice_database import start

from app.services.course_dashboard import week_start
from app.services.course_summaries import zagreb_today

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def dashboard(client, course):
    response = client.get(f"/courses/{course}/dashboard")
    assert response.status_code == 200, response.text
    return response.json()


def link(owner, question_id, *unit_ids):
    response = owner.patch(f"/questions/{question_id}/units", json={"unit_ids": list(unit_ids)})
    assert response.status_code == 200, response.text


def true_false(rows):
    return next(row for row in rows if row["type"] == "TRUE_FALSE")


def answer_true_false(member, course, value):
    attempt = start(member, course, 1, question_types=["TRUE_FALSE"])
    path = f"/courses/{course}/attempts/{attempt['id']}"
    saved = member.patch(
        f"{path}/answers/{attempt['questions'][0]['id']}",
        json={"type": "TRUE_FALSE", "value": value},
    )
    assert saved.status_code == 200, saved.text
    return path


def submit_true_false(member, course, *, value=False):
    """A one-question session on the true/false question; returns whether it was graded correct."""
    path = answer_true_false(member, course, value)
    result = member.post(path + "/submit")
    assert result.status_code == 200, result.text
    return result.json()["questions"][0]["grading_status"] == "CORRECT"


def this_monday() -> date:
    today = zagreb_today()
    return today - timedelta(days=today.weekday())


def test_a_course_nobody_practised_has_no_results(bank):
    owner, member, _, course, _ = bank
    unit(owner, course, "Logika")
    unit(owner, course, "Skupovi")
    data = dashboard(member, course)
    assert (data["units_total"], data["units_attempted"], data["average_percent"]) == (2, 0, None)
    assert [item["title"] for item in data["units"]] == ["Logika", "Skupovi"]
    assert all(item["attempts"] == 0 and item["best_percent"] is None for item in data["units"])


def test_a_submitted_session_counts_for_the_units_of_its_question(bank):
    owner, member, _, course, rows = bank
    first = unit(owner, course, "Logika")
    unit(owner, course, "Skupovi")
    link(owner, true_false(rows)["id"], first)
    expected = 100 if submit_true_false(member, course) else 0
    data = dashboard(member, course)
    assert (data["units_total"], data["units_attempted"]) == (2, 1)
    assert data["average_percent"] == expected
    by_title = {item["title"]: item for item in data["units"]}
    assert by_title["Logika"]["attempts"] == 1
    assert by_title["Logika"]["best_percent"] == by_title["Logika"]["last_percent"] == expected
    assert by_title["Skupovi"]["attempts"] == 0 and by_title["Skupovi"]["last_percent"] is None


def test_a_session_that_was_not_submitted_does_not_count(bank):
    owner, member, _, course, rows = bank
    link(owner, true_false(rows)["id"], unit(owner, course, "Logika"))
    answer_true_false(member, course, True)
    assert dashboard(member, course)["units_attempted"] == 0


def test_results_belong_to_the_caller_and_need_membership(bank):
    owner, member, stranger, course, rows = bank
    link(owner, true_false(rows)["id"], unit(owner, course, "Logika"))
    submit_true_false(member, course)
    assert dashboard(owner, course)["units_attempted"] == 0
    assert stranger.get(f"/courses/{course}/dashboard").status_code == 404
    assert stranger.get(f"/courses/{course}/progress-series").status_code == 404


def test_the_weekly_series_puts_a_submitted_session_in_this_week(bank):
    owner, member, _, course, rows = bank
    first = unit(owner, course, "Logika")
    unit(owner, course, "Skupovi")
    link(owner, true_false(rows)["id"], first)
    right = submit_true_false(member, course)
    response = member.get(f"/courses/{course}/progress-series", params={"weeks": 4})
    assert response.status_code == 200, response.text
    series = response.json()
    assert len(series["weeks"]) == 4 and series["weeks"][-1] == this_monday().isoformat()
    by_title = {item["title"]: item["cells"] for item in series["units"]}
    assert by_title["Logika"][-1] == {"percent": 100 if right else 0, "graded_count": 1}
    assert all(cell == {"percent": None, "graded_count": 0} for cell in by_title["Logika"][:-1])
    assert all(cell["graded_count"] == 0 for cell in by_title["Skupovi"])


def test_the_series_window_is_limited(bank):
    _, member, _, course, _ = bank
    assert member.get(f"/courses/{course}/progress-series", params={"weeks": 0}).status_code == 422
    assert member.get(f"/courses/{course}/progress-series", params={"weeks": 27}).status_code == 422


def test_a_week_starts_on_monday_in_zagreb_time():
    # 23:30 UTC on Sunday 2026-11-15 is already Monday 2026-11-16 in Zagreb.
    assert week_start(datetime(2026, 11, 15, 23, 30, tzinfo=UTC)) == date(2026, 11, 16)
    assert week_start(datetime(2026, 11, 15, 12, 0, tzinfo=UTC)) == date(2026, 11, 9)


def test_the_average_is_the_mean_of_the_sessions_not_their_sum(bank):
    owner, member, _, course, rows = bank
    link(owner, true_false(rows)["id"], unit(owner, course, "Logika"))
    results = [
        submit_true_false(member, course, value=False),
        submit_true_false(member, course, value=True),
    ]
    assert sorted(results) == [False, True]
    assert dashboard(member, course)["average_percent"] == 50
