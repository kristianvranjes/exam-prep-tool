"""Quiz (unit) review status, moderator counters and author/reviewer names (0034)."""

import os
from uuid import uuid4

import pytest
from community_helpers import provision, review_question
from fastapi.testclient import TestClient
from test_materials import clients as clients

from app.main import app

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def short(stem, **extra):
    return {"type": "SHORT_ANSWER", "stem": stem, "reference_answer": "A", **extra}


def make_unit(client, course, title="Logika"):
    created = client.post(f"/courses/{course}/units", json={"title": title})
    assert created.status_code == 201, created.text
    return created.json()


def import_into(client, course, unit, *questions):
    body = {"version": "quiz-import-v2", "questions": list(questions)}
    done = client.post(
        f"/courses/{course}/questions/import", params={"unit_ids": unit["id"]}, json=body
    )
    assert done.status_code == 201, done.text
    return done.json()


@pytest.fixture
def moderator(clients):
    """A faculty moderator who has not joined the course."""
    owner, _, _, course = clients
    with TestClient(app) as client:
        registered = client.post(
            "/auth/register",
            json={
                "email": f"mod-{uuid4().hex}@example.com",
                "password": "correct horse",
                "display_name": "Mia Moderator",
            },
        )
        assert registered.status_code == 201
        provision(client, owner.get(f"/courses/{course}").json()["faculty_id"])
        yield client


def test_new_units_are_drafts_with_their_author(clients):
    owner, member, _, course = clients
    unit = make_unit(owner, course)
    assert unit["status"] == "DRAFT" and unit["reviewer"] is None and unit["reviewed_at"] is None
    assert unit["author"]["display_name"] == "owner"
    listed = member.get(f"/courses/{course}/units").json()
    assert listed[0]["author"]["display_name"] == "owner" and listed[0]["status"] == "DRAFT"


def test_status_goes_draft_review_published_and_back(clients, moderator):
    owner, member, stranger, course = clients
    unit = make_unit(owner, course)
    path = f"/units/{unit['id']}/status"
    for client, expected in ((member, 403), (stranger, 404)):
        assert client.post(path, json={"status": "PENDING_REVIEW"}).status_code == expected
    # A moderator who does not own the course cannot send the unit for review, nor skip review.
    assert moderator.post(path, json={"status": "PENDING_REVIEW"}).status_code == 403
    assert moderator.post(path, json={"status": "PUBLISHED"}).status_code == 409
    assert owner.post(path, json={"status": "DRAFT"}).status_code == 409
    sent = owner.post(path, json={"status": "PENDING_REVIEW"})
    assert sent.status_code == 200 and sent.json()["status"] == "PENDING_REVIEW"
    assert owner.post(path, json={"status": "PENDING_REVIEW"}).status_code == 409
    assert member.post(path, json={"status": "PUBLISHED"}).status_code == 403
    published = moderator.post(path, json={"status": "PUBLISHED"}).json()
    assert published["status"] == "PUBLISHED" and published["reviewed_at"] is not None
    assert published["reviewer"]["display_name"] == "Mia Moderator"
    assert published["author"]["display_name"] == "owner"
    back = owner.post(path, json={"status": "DRAFT"}).json()
    assert back["status"] == "DRAFT" and back["reviewer"] is None and back["reviewed_at"] is None
    # The course owner is a faculty moderator here, so they may publish their own draft.
    mine = owner.post(path, json={"status": "PUBLISHED"}).json()
    assert mine["reviewer"]["display_name"] == "owner"
    owner.post(f"/units/{unit['id']}/archive")
    assert owner.post(path, json={"status": "DRAFT"}).status_code == 409
    assert owner.post(path, json={"status": "NOPE"}).status_code == 422
    assert owner.post(f"/units/{uuid4()}/status", json={"status": "DRAFT"}).status_code == 404


def test_moderator_list_and_detail_count_the_questions(clients, moderator):
    owner, member, stranger, course = clients
    logic = make_unit(owner, course)
    make_unit(owner, course, "Skupovi")
    rows = import_into(
        owner,
        course,
        logic,
        short("Has explanation", explanation="Why"),
        short("Has none"),
        short("Third", explanation="Why"),
    )
    assert owner.post(f"/questions/{rows[0]['id']}/submit").status_code == 200
    assert review_question(owner, f"/questions/{rows[0]['id']}/approve").status_code == 200
    reported = member.post(f"/questions/{rows[0]['id']}/reports", json={"reason": "TYPO"})
    assert reported.status_code == 201

    path = f"/courses/{course}/units/moderation"
    assert member.get(path).status_code == 403
    assert stranger.get(path).status_code == 404
    assert owner.get(f"/courses/{uuid4()}/units/moderation").status_code == 404
    for client in (owner, moderator):
        listed = client.get(path).json()
        assert [row["title"] for row in listed] == ["Logika", "Skupovi"]
        row, empty = listed
        assert row["question_count"] == 3 and row["draft_count"] == 2
        assert row["pending_review_count"] == 0 and row["rejected_count"] == 0
        assert row["approved_question_count"] == 1
        assert row["without_explanation_count"] == 1
        assert row["open_report_count"] == 1 and row["open_suggestion_count"] == 0
        assert row["author"]["display_name"] == "owner" and row["status"] == "DRAFT"
        assert row["last_changed_at"] >= row["updated_at"]
        assert empty["question_count"] == 0 and empty["last_changed_at"] == empty["updated_at"]

    detail = moderator.get(f"/units/{logic['id']}/moderation")
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["unit"]["question_count"] == 3
    by_stem = {question["stem"]: question for question in body["questions"]}
    assert by_stem["Has explanation"]["status"] == "APPROVED"
    assert by_stem["Has explanation"]["open_report_count"] == 1
    assert by_stem["Has none"]["has_explanation"] is False
    assert by_stem["Has none"]["author"]["display_name"] == "owner"
    assert by_stem["Third"]["open_report_count"] == 0
    page = owner.get(f"/units/{logic['id']}/moderation", params={"limit": 1, "offset": 1}).json()
    assert len(page["questions"]) == 1 and page["unit"]["question_count"] == 3
    assert member.get(f"/units/{logic['id']}/moderation").status_code == 403
    assert stranger.get(f"/units/{logic['id']}/moderation").status_code == 404


def test_faculty_counters_and_review_queue_names(clients, moderator):
    owner, member, _, course = clients
    unit = make_unit(owner, course)
    rows = import_into(owner, course, unit, short("Waiting"), short("Reported", explanation="Y"))
    assert owner.post(f"/questions/{rows[0]['id']}/submit").status_code == 200
    assert owner.post(f"/questions/{rows[1]['id']}/submit").status_code == 200
    assert review_question(owner, f"/questions/{rows[1]['id']}/approve").status_code == 200
    member.post(f"/questions/{rows[1]['id']}/reports", json={"reason": "TYPO"})
    owner.post(f"/units/{unit['id']}/status", json={"status": "PENDING_REVIEW"})
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]

    path = f"/faculties/{faculty}/moderation-counts"
    assert member.get(path).status_code == 403
    counts = moderator.get(path).json()
    assert counts == {
        "pending_questions": 1,
        "open_reports": 1,
        "open_suggestions": 0,
        "pending_units": 1,
    }
    assert moderator.get(path, params={"course_id": course}).json() == counts
    assert moderator.get(path, params={"course_id": str(uuid4())}).status_code == 404

    queue = moderator.get(f"/faculties/{faculty}/question-review").json()
    assert [q["stem"] for q in queue] == ["Waiting"]
    assert queue[0]["author_name"] == "owner" and queue[0]["reviewer_name"] is None
    approved = moderator.get(
        f"/faculties/{faculty}/question-review", params={"status": "APPROVED"}
    ).json()
    assert approved[0]["author_name"] == "owner"
    assert approved[0]["reviewer_name"] == "Reviewer"


def answer_true_false(client, course, value):
    started = client.post(
        f"/courses/{course}/attempts",
        json={"count": 1, "question_types": ["TRUE_FALSE"], "selection_mode": "STANDARD"},
    )
    assert started.status_code == 201, started.text
    attempt = started.json()
    path = f"/courses/{course}/attempts/{attempt['id']}"
    question = attempt["questions"][0]["id"]
    saved = client.patch(f"{path}/answers/{question}", json={"type": "TRUE_FALSE", "value": value})
    assert saved.status_code == 200, saved.text
    assert client.post(f"{path}/submit").status_code == 200


def test_question_table_lists_quizzes_reports_and_accuracy(clients, moderator):
    owner, member, stranger, course = clients
    logic = make_unit(owner, course)
    sets = make_unit(owner, course, "Skupovi")
    rows = import_into(owner, course, logic, short("Reported one"), short("Plain one"))
    loose = owner.post(f"/courses/{course}/questions", json=short("Loose one"))
    assert loose.status_code == 201, loose.text
    true_false = owner.post(
        f"/courses/{course}/questions",
        json={
            "type": "TRUE_FALSE",
            "stem": "Hard one",
            "correct_answer": True,
            "unit_ids": [logic["id"], sets["id"]],
        },
    )
    assert true_false.status_code == 201, true_false.text
    hard = true_false.json()["id"]
    for question in (rows[0]["id"], hard):
        assert owner.post(f"/questions/{question}/submit").status_code == 200
        assert review_question(owner, f"/questions/{question}/approve").status_code == 200
    reported = member.post(f"/questions/{rows[0]['id']}/reports", json={"reason": "TYPO"})
    assert reported.status_code == 201
    # One right and four wrong answers: 20 %, from the five answers the table needs.
    for value in (True, False, False, False):
        answer_true_false(member, course, value)

    path = f"/courses/{course}/question-table"
    assert member.get(path).status_code == 403
    assert stranger.get(path).status_code == 404
    table = moderator.get(path)
    assert table.status_code == 200, table.text
    body = table.json()
    assert body["total"] == 4 and body["min_answers"] == 5 and body["question_count"] == 4
    by_stem = {row["stem"]: row for row in body["rows"]}
    assert by_stem["Reported one"]["open_report_count"] == 1
    assert by_stem["Hard one"]["unit_ids"] == [logic["id"], sets["id"]]
    assert by_stem["Loose one"]["unit_ids"] == []
    # Four answers are too few for a share.
    assert by_stem["Hard one"]["answer_count"] == 4 and by_stem["Hard one"]["accuracy"] is None
    topics = {topic["unit_id"]: topic["count"] for topic in body["topics"]}
    assert topics == {logic["id"]: 3, sets["id"]: 1, None: 1}

    answer_true_false(member, course, False)
    low = owner.get(path, params={"show": "LOW_ACCURACY"}).json()
    assert [row["stem"] for row in low["rows"]] == ["Hard one"] and low["total"] == 1
    assert low["rows"][0]["accuracy"] == 0.2 and low["rows"][0]["answer_count"] == 5
    assert [row["stem"] for row in owner.get(path, params={"show": "REPORTED"}).json()["rows"]] == [
        "Reported one"
    ]
    assert [row["stem"] for row in owner.get(path, params={"unit": "none"}).json()["rows"]] == [
        "Loose one"
    ]
    assert [row["stem"] for row in owner.get(path, params={"unit": sets["id"]}).json()["rows"]] == [
        "Hard one"
    ]
    assert [row["stem"] for row in owner.get(path, params={"q": "PLAIN"}).json()["rows"]] == [
        "Plain one"
    ]
    # A literal percent sign matches only itself.
    assert owner.get(path, params={"q": "%"}).json()["total"] == 0
    paged = owner.get(path, params={"limit": 1, "offset": 1}).json()
    assert len(paged["rows"]) == 1 and paged["total"] == 4
    assert owner.get(path, params={"unit": "not-a-unit"}).status_code == 422
