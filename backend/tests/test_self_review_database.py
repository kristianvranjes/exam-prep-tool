import os

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from migration_helpers import legacy_review_columns
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from test_paper_sessions_database import published, take
from test_practice_database import bank as bank
from test_practice_database import clients as clients
from test_practice_database import payload, save_all, start

from alembic import command
from app.database import engine
from app.main import app

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

ANSWER_COLUMNS = (
    "id, attempt_id, quiz_question_id, payload, grading_status, grading_method, "
    "grading_version, checked_at, confidence, updated_at"
)


def review(client, path, question, verdict):
    return client.patch(f"{path}/answers/{question['id']}/self-review", json={"verdict": verdict})


def short_of(attempt):
    return next(q for q in attempt["questions"] if q["type"] == "SHORT_ANSWER")


def objective_of(attempt):
    return next(q for q in attempt["questions"] if q["type"] != "SHORT_ANSWER")


def graded_rows():
    """Everything self-assessment must leave alone, including the answer's own timestamp."""
    with engine.connect() as conn:
        return {
            "answers": conn.execute(
                text(f"SELECT {ANSWER_COLUMNS} FROM answers ORDER BY id")
            ).all(),
            "progress": conn.execute(
                text(
                    "SELECT "
                    + legacy_review_columns(conn)
                    + " FROM question_review_progress ORDER BY id"
                )
            ).all(),
        }


def self_review_row(question_id):
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT self_review, self_reviewed_at FROM answers WHERE quiz_question_id = :id"),
            {"id": question_id},
        ).one()


def summary(client, course):
    response = client.get(f"/courses/{course}/review-progress/summary")
    assert response.status_code == 200, response.text
    return response.json() | {"as_of": None}


def without_self_review(attempt):
    """A submitted payload with the self-assessment fields removed."""
    return attempt | {
        "self_review": None,
        "questions": [q | {"self_review": None} for q in attempt["questions"]],
    }


def test_guided_check_reveals_then_self_review_is_changeable_and_idempotent(bank):
    _, member, _, course, _ = bank
    attempt = start(member, course, feedback_mode="IMMEDIATE")
    path = save_all(member, course, attempt)
    short, objective = short_of(attempt), objective_of(attempt)
    # The reference answer is not visible yet, so there is nothing to compare against.
    assert review(member, path, short, "CORRECT").status_code == 409
    checked = member.post(f"{path}/answers/{short['id']}/check", json={}).json()
    feedback = checked["questions"][short["position"]]["feedback"]
    assert feedback["grading_status"] == "PENDING" and feedback["self_review"] is None
    before = graded_rows()

    response = review(member, path, short, "CORRECT")
    assert response.status_code == 200, response.text
    assessed = response.json()
    assert assessed["status"] == "ACTIVE"
    shown = assessed["questions"][short["position"]]["feedback"]
    assert shown == feedback | {"self_review": "CORRECT"}
    first = self_review_row(short["id"])
    assert first.self_review == "CORRECT" and first.self_reviewed_at is not None
    # Repeating the same verdict changes nothing, not even its time.
    assert review(member, path, short, "CORRECT").json() == assessed
    assert self_review_row(short["id"]) == first
    changed = review(member, path, short, "INCORRECT").json()
    assert changed["questions"][short["position"]]["feedback"]["self_review"] == "INCORRECT"
    cleared = review(member, path, short, None).json()
    assert cleared["questions"][short["position"]]["feedback"]["self_review"] is None
    assert tuple(self_review_row(short["id"])) == (None, None)
    assert graded_rows() == before

    # Objective answers are graded, never self-assessed.
    member.post(f"{path}/answers/{objective['id']}/check", json={})
    assert review(member, path, objective, "CORRECT").status_code == 409
    for body in ({}, {"verdict": "MAYBE"}, {"verdict": "CORRECT", "extra": 1}):
        response = member.patch(f"{path}/answers/{short['id']}/self-review", json=body)
        assert response.status_code == 422

    assert review(member, path, short, "CORRECT").status_code == 200
    result = member.post(path + "/submit").json()
    graded = result["questions"][short["position"]]
    assert (graded["grading_status"], graded["self_review"]) == ("PENDING", "CORRECT")
    assert result["self_review"] == {
        "correct": 1,
        "incorrect": 0,
        "unreviewed": 0,
        "correct_points": None,
        "unreviewed_points": None,
    }
    progress = member.get(f"/courses/{course}/review-progress").json()
    assert short["source_question_id"] not in {row["question_id"] for row in progress}


def test_submitted_results_take_self_review_without_changing_grading(bank):
    owner, member, _, course, _ = bank
    attempt = start(member, course)
    path = save_all(member, course, attempt)
    short = short_of(attempt)
    # Ending sessions reveal the reference only after submission.
    assert review(member, path, short, "CORRECT").status_code == 409
    frozen = member.post(path + "/submit").json()
    assert frozen["self_review"] == {
        "correct": 0,
        "incorrect": 0,
        "unreviewed": 1,
        "correct_points": None,
        "unreviewed_points": None,
    }
    before = graded_rows()
    progress = summary(member, course)
    analysis = owner.get(f"/courses/{course}/item-analysis").json()

    assessed = review(member, path, short, "INCORRECT")
    assert assessed.status_code == 200, assessed.text
    assessed = assessed.json()
    assert assessed["questions"][short["position"]]["self_review"] == "INCORRECT"
    assert assessed["self_review"]["incorrect"] == 1 and assessed["self_review"]["unreviewed"] == 0
    assert without_self_review(assessed) == without_self_review(frozen)
    assert member.get(path).json() == assessed
    # Resubmitting stays a no-op that returns the same frozen results.
    assert member.post(path + "/submit").json() == assessed
    assert graded_rows() == before
    assert summary(member, course) == progress
    assert owner.get(f"/courses/{course}/item-analysis").json() == analysis
    # The database refuses a self-assessment on a deterministically graded answer.
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE answers SET self_review = 'CORRECT', self_reviewed_at = now() "
                "WHERE grading_method = 'DETERMINISTIC'"
            )
        )


def test_only_the_owner_of_a_visible_attempt_self_reviews(bank):
    owner, member, stranger, course, _ = bank
    attempt = start(member, course)
    path = save_all(member, course, attempt)
    member.post(path + "/submit")
    short = short_of(attempt)
    for client in (owner, stranger):
        assert review(client, path, short, "CORRECT").status_code == 404
    with TestClient(app) as anonymous:
        assert review(anonymous, path, short, "CORRECT").status_code == 401
    assert review(member, path, {"id": attempt["id"]}, "CORRECT").status_code == 404
    other = f"/courses/{course}/attempts/{start(member, course)['id']}"
    assert review(member, other, short, "CORRECT").status_code == 404
    assert self_review_row(short["id"]).self_review is None
    # Abandoned sessions are frozen, checked or not.
    guided = start(member, course, feedback_mode="IMMEDIATE")
    guided_path = save_all(member, course, guided)
    member.post(f"{guided_path}/answers/{short_of(guided)['id']}/check", json={})
    member.post(guided_path + "/abandon")
    assert review(member, guided_path, short_of(guided), "CORRECT").status_code == 409


def test_paper_reports_self_assessed_points_apart_from_the_objective_score(bank):
    owner, member, _, course, rows = bank
    _, paper_path = published(owner, course, rows)
    attempt = take(member, paper_path)
    path = save_all(member, course, attempt)
    short = short_of(attempt)
    frozen = member.post(path + "/submit").json()
    points = short["points"]
    assert frozen["score"]["pending_points"] == points
    assert frozen["self_review"]["correct_points"] == 0
    assert frozen["self_review"]["unreviewed_points"] == points

    assessed = review(member, path, short, "CORRECT").json()
    assert assessed["score"] == frozen["score"]
    assert assessed["questions"][short["position"]]["earned_points"] is None
    assert assessed["self_review"] == {
        "correct": 1,
        "incorrect": 0,
        "unreviewed": 0,
        "correct_points": points,
        "unreviewed_points": 0,
    }
    missed = review(member, path, short, "INCORRECT").json()
    assert missed["score"] == frozen["score"]
    assert missed["self_review"]["correct_points"] == 0
    assert missed["self_review"]["unreviewed_points"] == 0

    # A blank paper item has nothing to assess.
    blank_attempt = take(member, paper_path)
    blank_path = f"/courses/{course}/attempts/{blank_attempt['id']}"
    for question in blank_attempt["questions"]:
        if question["type"] != "SHORT_ANSWER":
            member.patch(f"{blank_path}/answers/{question['id']}", json=payload(question))
    blank = member.post(blank_path + "/submit").json()
    assert blank["self_review"]["unreviewed"] == 0
    assert review(member, blank_path, short_of(blank_attempt), "CORRECT").status_code == 409


def test_0025_roundtrip_keeps_answers_and_guards_recorded_self_reviews(bank):
    _, member, _, course, _ = bank
    attempt = start(member, course)
    path = save_all(member, course, attempt)
    frozen = member.post(path + "/submit").json()
    short = short_of(attempt)
    before = graded_rows()
    assessed = review(member, path, short, "CORRECT").json()
    config = Config("alembic.ini")
    try:
        with pytest.raises(RuntimeError, match="self-assessments exist"):
            command.downgrade(config, "0024")
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0037"
        assert member.get(path).json() == assessed
        review(member, path, short, None)
        for _ in range(2):
            command.downgrade(config, "0024")
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0024"
                columns = conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema = current_schema() AND table_name = 'answers'"
                    )
                ).scalars()
                assert not {"self_review", "self_reviewed_at"} & set(columns)
            assert graded_rows() == before
            command.upgrade(config, "head")
            assert graded_rows() == before
            assert member.get(path).json() == frozen
    finally:
        command.upgrade(config, "head")
