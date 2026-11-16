import os
from uuid import uuid4

import pytest
from test_course_dashboard_database import link, submit_true_false, true_false
from test_exam_scopes_database import scope, unit
from test_materials import clients as clients
from test_paper_sessions_database import POINTS, published
from test_practice_database import bank as bank

from app.services.exam_estimate import MIN_ANSWERS

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def estimate(client, scope_id):
    response = client.get(f"/exam-scopes/{scope_id}/estimate")
    assert response.status_code == 200, response.text
    return response.json()


def prepared(bank):
    """A scope over two topics and a published paper: the multiple-choice question sits in the first
    topic, the true/false one in the second, the short answer in neither."""
    owner, member, stranger, course, rows = bank
    first = unit(owner, course, "Logika")
    second = unit(owner, course, "Skupovi")
    link(owner, rows[0]["id"], first)
    link(owner, true_false(rows)["id"], second)
    exam = scope(
        owner,
        course,
        academic_year="2025/26",
        kind="FINAL",
        name="Završni",
        unit_ids=[first, second],
    )
    paper, path = published(owner, course, rows, exam_scope_id=exam["id"])
    return owner, member, stranger, course, rows, exam, path


def test_points_come_from_the_published_papers_before_any_answer(bank):
    _, member, _, _, rows, exam, _ = prepared(bank)
    data = estimate(member, exam["id"])
    assert (data["paper_count"], data["answer_count"], data["max_points"]) == (1, 0, 6)
    assert data["pass_threshold"] == 4 and data["estimate"] is None
    assert {row["title"]: row["exam_points"] for row in data["topics"]} == {
        "Logika": POINTS[0],
        "Skupovi": POINTS[rows.index(true_false(rows))],
    }
    assert all(row["accuracy"] is None and row["expected_points"] is None for row in data["topics"])


def test_answers_give_a_range_once_there_are_enough_of_them(bank):
    owner, member, _, course, _, exam, _ = prepared(bank)
    right = sum(submit_true_false(member, course) for _ in range(MIN_ANSWERS))
    data = estimate(member, exam["id"])
    assert data["answer_count"] == MIN_ANSWERS
    by_title = {row["title"]: row for row in data["topics"]}
    assert by_title["Skupovi"]["answer_count"] == MIN_ANSWERS
    assert by_title["Skupovi"]["accuracy"] == pytest.approx(right / MIN_ANSWERS)
    assert by_title["Logika"]["answer_count"] == 0
    assert data["estimate"] is not None
    assert data["estimate"]["low"] <= data["estimate"]["expected"] <= data["estimate"]["high"]
    assert data["estimate"]["high"] <= data["max_points"]
    # Answers belong to the caller.
    assert estimate(owner, exam["id"])["answer_count"] == 0


def test_an_unpublished_paper_no_longer_counts(bank):
    owner, member, _, _, _, exam, path = prepared(bank)
    assert owner.post(path + "/unpublish").status_code == 200
    data = estimate(member, exam["id"])
    assert (data["paper_count"], data["topics"], data["max_points"]) == (0, [], None)


def test_the_estimate_needs_membership_and_an_existing_scope(bank):
    _, member, stranger, _, _, exam, _ = prepared(bank)
    assert stranger.get(f"/exam-scopes/{exam['id']}/estimate").status_code == 404
    assert member.get(f"/exam-scopes/{uuid4()}/estimate").status_code == 404
