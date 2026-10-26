import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Event
from uuid import UUID, uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError
from test_materials import clients as clients
from test_practice_database import assert_no_keys, payload, save_all, start
from test_practice_database import bank as bank

from alembic import command
from app.database import SessionLocal, engine
from app.main import app
from app.models import CourseMembership
from app.models.quiz import QuizAttempt
from app.services import quizzes

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def retained_rows():
    with engine.connect() as conn:
        return {
            table: conn.execute(text(f"SELECT * FROM {table} ORDER BY id")).all()
            for table in ("quizzes", "quiz_questions", "answers", "question_review_progress")
        }


@pytest.mark.parametrize("saved_count", [0, 1, 3])
def test_abandon_preserves_saved_answers_snapshots_progress_and_private_history(
    bank, monkeypatch, saved_count
):
    _, member, _, course, _ = bank
    # Existing learning progress must also remain untouched.
    previous = start(member, course)
    assert member.post(save_all(member, course, previous) + "/submit").status_code == 200
    attempt = start(member, course)
    path = f"/courses/{course}/attempts/{attempt['id']}"
    for question in attempt["questions"][:saved_count]:
        response = member.patch(f"{path}/answers/{question['id']}", json=payload(question))
        assert response.status_code == 200
    saved = member.get(path).json()
    before = retained_rows()

    def forbidden(*args):
        raise AssertionError("Abandonment must not grade or apply reviews")

    monkeypatch.setattr(quizzes, "grade", forbidden)
    monkeypatch.setattr(quizzes, "apply_reviews", forbidden)
    before_time = datetime.now(UTC)
    response = member.post(path + "/abandon")
    assert response.status_code == 200, response.text
    abandoned = response.json()
    assert_no_keys(abandoned)
    assert abandoned == saved | {"status": "ABANDONED", "abandoned_at": abandoned["abandoned_at"]}
    assert abandoned["submitted_at"] is None
    assert before_time <= datetime.fromisoformat(abandoned["abandoned_at"]) <= datetime.now(UTC)
    assert retained_rows() == before
    assert member.get(path).json() == abandoned
    assert member.post(path + "/abandon").json() == abandoned
    assert retained_rows() == before
    assert member.post(path + "/submit").status_code == 409
    question = attempt["questions"][0]
    assert (
        member.patch(f"{path}/answers/{question['id']}", json=payload(question)).status_code == 409
    )
    assert member.get(path).json() == abandoned
    history = member.get(f"/courses/{course}/attempts?limit=1&offset=0").json()
    assert history == [
        {key: value for key, value in abandoned.items() if key not in {"questions", "abandoned_at"}}
    ]
    assert (
        member.get(f"/courses/{course}/attempts?limit=1&offset=1").json()[0]["id"] == previous["id"]
    )


def test_submitted_attempt_cannot_be_abandoned_or_changed(bank):
    _, member, _, course, _ = bank
    path = save_all(member, course, start(member, course))
    frozen = member.post(path + "/submit").json()
    before = retained_rows()
    assert member.post(path + "/abandon").status_code == 409
    assert member.get(path).json() == frozen
    assert member.post(path + "/submit").json() == frozen
    assert retained_rows() == before
    with SessionLocal() as db:
        assert db.get(QuizAttempt, UUID(frozen["id"])).abandoned_at is None


def test_abandon_authorization_and_detail_privacy(bank):
    owner, member, stranger, course, _ = bank
    attempt = start(member, course)
    path = f"/courses/{course}/attempts/{attempt['id']}"
    before = retained_rows()
    with TestClient(app) as anonymous:
        assert anonymous.post(path + "/abandon").status_code == 401
    for client in (owner, stranger):
        assert client.post(path + "/abandon").status_code == 404
        assert client.get(path).status_code == 404
    assert member.post(f"/courses/{uuid4()}/attempts/{attempt['id']}/abandon").status_code == 404
    assert member.post(f"/courses/{course}/attempts/{uuid4()}/abandon").status_code == 404
    assert retained_rows() == before
    abandoned = member.post(path + "/abandon").json()
    assert_no_keys(abandoned)
    assert set(abandoned) == {
        "id",
        "course_id",
        "status",
        "started_at",
        "submitted_at",
        "abandoned_at",
        "exam_scope_id",
        "focus_unit_ids",
        "focus_label",
        "feedback_mode",
        "paper",
        "deadline_at",
        "server_time",
        "questions",
    }
    for question in abandoned["questions"]:
        assert set(question) == {
            "id",
            "source_question_id",
            "position",
            "type",
            "stem",
            "difficulty",
            "options",
            "answer",
            "units",
            "favorite",
            "feedback",
            "points",
            "label",
        }
        # An END session never checks answers, so nothing is revealed.
        assert question["feedback"] is None
        # Live, not frozen: approved bank questions can still be favorited.
        assert question["favorite"] is False
        # Only paper sessions carry points and labels.
        assert question["points"] is None and question["label"] is None
    with SessionLocal() as db:
        user_id = UUID(member.get("/auth/me").json()["id"])
        db.execute(delete(CourseMembership).where(CourseMembership.user_id == user_id))
        db.commit()
    assert member.get(path).status_code == 404
    assert member.post(path + "/abandon").status_code == 404


def test_abandon_releases_only_its_active_sources_and_keeps_seen_history(bank):
    _, member, _, course, rows = bank
    first = start(member, course, 1, question_types=["TRUE_FALSE"], selection_mode="ADAPTIVE")
    second = start(member, course, 1, question_types=["MULTIPLE_CHOICE"], selection_mode="ADAPTIVE")
    path = f"/courses/{course}/attempts"
    assert (
        member.post(
            path, json={"count": 1, "selection_mode": "ADAPTIVE", "question_types": ["TRUE_FALSE"]}
        ).status_code
        == 409
    )
    before = retained_rows()
    assert member.post(f"{path}/{first['id']}/abandon").status_code == 200
    assert retained_rows() == before
    released = start(member, course, 1, question_types=["TRUE_FALSE"], selection_mode="ADAPTIVE")
    assert released["questions"][0]["stem"] == first["questions"][0]["stem"]
    assert (
        member.post(
            path,
            json={"count": 1, "selection_mode": "ADAPTIVE", "question_types": ["MULTIPLE_CHOICE"]},
        ).status_code
        == 409
    )
    assert member.get(f"{path}/{second['id']}").json()["status"] == "ACTIVE"
    # With all sources eligible again, the genuinely unseen short answer ranks first.
    assert member.post(f"{path}/{released['id']}/abandon").status_code == 200
    assert member.post(f"{path}/{second['id']}/abandon").status_code == 200
    ordered = start(member, course, 3, selection_mode="ADAPTIVE")
    assert ordered["questions"][0]["type"] == "SHORT_ANSWER"
    assert {q["stem"] for q in ordered["questions"]} == {q["stem"] for q in rows}


def test_another_active_attempt_keeps_the_same_source_excluded(bank):
    _, member, _, course, _ = bank
    first = start(member, course, 1, question_types=["TRUE_FALSE"])
    second = start(member, course, 1, question_types=["TRUE_FALSE"])
    path = f"/courses/{course}/attempts"
    assert member.post(f"{path}/{first['id']}/abandon").status_code == 200
    response = member.post(
        path, json={"count": 1, "selection_mode": "ADAPTIVE", "question_types": ["TRUE_FALSE"]}
    )
    assert response.status_code == 409
    assert member.get(f"{path}/{second['id']}").json()["status"] == "ACTIVE"
    assert member.post(f"{path}/{second['id']}/abandon").status_code == 200
    assert (
        start(member, course, 1, question_types=["TRUE_FALSE"], selection_mode="ADAPTIVE")["status"]
        == "ACTIVE"
    )


def test_abandon_rolls_back_before_commit(bank, monkeypatch):
    _, member, _, course, _ = bank
    path = save_all(member, course, start(member, course))
    original = member.get(path).json()
    before = retained_rows()
    representation = quizzes.representation

    def fail(db, attempt, course_id):
        if attempt.status == "ABANDONED":
            raise RuntimeError("Injected abandonment failure")
        return representation(db, attempt, course_id)

    monkeypatch.setattr(quizzes, "representation", fail)
    with pytest.raises(RuntimeError, match="Injected"):
        member.post(path + "/abandon")
    assert member.get(path).json() == original
    assert retained_rows() == before
    with SessionLocal() as db:
        assert db.get(QuizAttempt, UUID(original["id"])).abandoned_at is None


@pytest.mark.parametrize(
    "first_action,second_action",
    [
        ("abandon", "save"),
        ("save", "abandon"),
        ("abandon", "submit"),
        ("submit", "abandon"),
        ("abandon", "abandon"),
    ],
)
def test_abandon_serializes_with_save_submit_and_repeat(
    bank, monkeypatch, first_action, second_action
):
    _, member, _, course, _ = bank
    attempt = start(member, course, 1, question_types=["TRUE_FALSE"])
    path = save_all(member, course, attempt)
    first_locked, second_started, release_first = Event(), Event(), Event()
    original = quizzes.load_attempt

    def controlled_load(*args):
        if first_locked.is_set():
            second_started.set()
            return original(*args)
        result = original(*args)
        first_locked.set()
        assert release_first.wait(10)
        return result

    monkeypatch.setattr(quizzes, "load_attempt", controlled_load)

    def request(action):
        with TestClient(app) as client:
            client.cookies.update(member.cookies)
            if action == "save":
                return client.patch(
                    f"{path}/answers/{attempt['questions'][0]['id']}",
                    json={"type": "TRUE_FALSE", "value": True},
                )
            return client.post(f"{path}/{action}")

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(request, first_action)
        try:
            assert first_locked.wait(10)
            second = pool.submit(request, second_action)
            assert second_started.wait(10)
        finally:
            release_first.set()
        first_response, second_response = first.result(timeout=10), second.result(timeout=10)
    assert first_response.status_code == 200
    assert second_response.status_code == (
        200 if first_action == "save" or second_action == first_action else 409
    )
    result = member.get(path).json()
    if first_action == "submit":
        assert result["status"] == "SUBMITTED"
        assert first_response.json() == result
    else:
        assert result["status"] == "ABANDONED"
        assert result["questions"][0]["answer"]["value"] is (first_action == "save")
        assert_no_keys(result)
        if second_action == "abandon" and first_action == "abandon":
            assert first_response.json() == second_response.json() == result
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM question_review_progress")) == int(
            first_action == "submit"
        )


@pytest.mark.parametrize(
    "assignment",
    [
        "status = 'ABANDONED'",
        "abandoned_at = now()",
        "submitted_at = now()",
        "status = 'ABANDONED', abandoned_at = now(), submitted_at = now()",
        "status = 'SUBMITTED'",
        "status = 'UNKNOWN'",
    ],
)
def test_abandonment_timestamp_constraints(bank, assignment):
    _, member, _, course, _ = bank
    start(member, course)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text(f"UPDATE quiz_attempts SET {assignment}"))


def test_0015_roundtrip_preserves_existing_active_and_submitted_history(bank):
    _, member, _, course, _ = bank
    submitted_path = save_all(member, course, start(member, course))
    frozen = member.post(submitted_path + "/submit").json()
    active = start(member, course)
    active_path = f"/courses/{course}/attempts/{active['id']}"
    before = retained_rows()
    config = Config("alembic.ini")
    try:
        for _ in range(2):
            command.downgrade(config, "0014")
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0014"
            command.upgrade(config, "head")
            assert retained_rows() == before
            assert member.get(submitted_path).json() == frozen
            assert member.get(active_path).json() == active
            with engine.connect() as conn:
                assert (
                    conn.scalar(
                        text("SELECT count(*) FROM quiz_attempts WHERE abandoned_at IS NOT NULL")
                    )
                    == 0
                )
    finally:
        command.upgrade(config, "head")


def test_0015_downgrade_refuses_to_erase_abandoned_history(bank):
    _, member, _, course, _ = bank
    path = save_all(member, course, start(member, course))
    abandoned = member.post(path + "/abandon").json()
    before = retained_rows()
    with pytest.raises(RuntimeError, match="abandoned attempts exist"):
        command.downgrade(Config("alembic.ini"), "0014")
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0023"
    assert member.get(path).json() == abandoned
    assert retained_rows() == before
