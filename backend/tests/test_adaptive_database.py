import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, text
from test_materials import clients as clients
from test_practice_database import assert_no_keys, save_all, start
from test_quiz_import import document

from app.database import SessionLocal, engine
from app.main import app
from app.models.question import Question
from app.models.quiz import QuizQuestion
from app.models.user_question_progress import UserQuestionProgress
from app.schemas.quiz import StartQuiz
from app.services import quizzes
from app.services.quiz_selection import select_questions

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")
NOW = datetime(2026, 1, 10, tzinfo=UTC)


@pytest.fixture
def bank(clients):
    owner, member, stranger, course = clients
    example = next(q for q in document()["questions"] if q["type"] == "SHORT_ANSWER")
    body = document()
    body["questions"] = [dict(example, stem=f"Question {i}") for i in range(8)]
    response = owner.post(f"/courses/{course}/questions/import", json=body)
    assert response.status_code == 201, response.text
    rows = response.json()
    for row in rows:
        assert row["concept_ids"] == [] and row["source"] == "USER"
        assert owner.post(f"/questions/{row['id']}/submit").status_code == 200
        assert owner.post(f"/questions/{row['id']}/approve").status_code == 200
    with SessionLocal() as db:
        for i, row in enumerate(rows):
            db.get(Question, UUID(row["id"])).created_at = NOW + timedelta(seconds=i)
        db.commit()
    return owner, member, stranger, course, rows


def ids(attempt):
    with SessionLocal() as db:
        return [
            str(q.source_question_id)
            for q in db.scalars(
                select(QuizQuestion)
                .where(
                    QuizQuestion.quiz_id
                    == select(QuizQuestion.quiz_id)
                    .where(QuizQuestion.id == UUID(attempt["questions"][0]["id"]))
                    .scalar_subquery()
                )
                .order_by(QuizQuestion.position)
            )
        ]


def stored_progress():
    with engine.connect() as conn:
        return conn.execute(text("SELECT * FROM question_review_progress ORDER BY id")).all()


def add_progress(member, rows, dates):
    user_id = UUID(member.get("/auth/me").json()["id"])
    with SessionLocal() as db:
        for i, due in dates.items():
            db.add(
                UserQuestionProgress(
                    user_id=user_id,
                    question_id=UUID(rows[i]["id"]),
                    review_stage=1,
                    resolved_review_count=1,
                    correct_review_count=1,
                    incorrect_review_count=0,
                    last_result="CORRECT",
                    last_reviewed_at=NOW - timedelta(days=2),
                    due_at=due,
                    scheduling_version="leitner-v1",
                )
            )
        db.commit()


def seed_seen(member, course, count=6):
    attempt = start(member, course, count)
    path = save_all(member, course, attempt)
    result = member.post(path + "/submit")
    assert result.status_code == 200, result.text
    assert all(q["grading_status"] == "PENDING" for q in result.json()["questions"])
    assert stored_progress() == []


def test_rank_due_unseen_future_pending_and_single_clock(bank, monkeypatch):
    _, member, _, course, rows = bank
    seed_seen(member, course)
    add_progress(
        member,
        rows,
        {
            0: NOW,
            1: NOW - timedelta(days=1),
            2: NOW + timedelta(days=2),
            3: NOW + timedelta(microseconds=1),
        },
    )
    before = stored_progress()

    class Clock:
        calls = 0

        @classmethod
        def now(cls, tz):
            assert tz == UTC
            cls.calls += 1
            return NOW

    monkeypatch.setattr(quizzes, "datetime", Clock)
    attempt = start(member, course, 8, selection_mode="ADAPTIVE")
    assert Clock.calls == 1
    assert ids(attempt) == [rows[i]["id"] for i in [1, 0, 6, 7, 3, 2, 4, 5]]
    assert stored_progress() == before
    assert_no_keys(attempt)


def test_standard_default_explicit_and_adaptive_active_exclusion(bank):
    _, member, _, course, rows = bank
    first = start(member, course, 2)
    explicit = start(member, course, 2, selection_mode="STANDARD")
    assert ids(first) == ids(explicit) == [q["id"] for q in rows[:2]]
    adaptive = start(member, course, 6, selection_mode="ADAPTIVE")
    assert ids(adaptive) == [q["id"] for q in rows[2:]]
    response = member.post(
        f"/courses/{course}/attempts", json={"count": 1, "selection_mode": "ADAPTIVE"}
    )
    assert response.status_code == 409 and "Only 0 eligible" in response.json()["detail"]
    assert stored_progress() == []


def test_user_history_progress_active_and_course_isolation(bank):
    owner, member, stranger, course, rows = bank
    seed_seen(owner, course, 8)
    add_progress(owner, rows, {7: NOW - timedelta(days=1)})
    start(owner, course, 4)
    assert ids(start(member, course, 8, selection_mode="ADAPTIVE")) == [r["id"] for r in rows]
    path = f"/courses/{course}/attempts"
    assert stranger.post(path, json={"count": 1, "selection_mode": "ADAPTIVE"}).status_code == 404
    with TestClient(app) as anonymous:
        assert (
            anonymous.post(path, json={"count": 1, "selection_mode": "ADAPTIVE"}).status_code == 401
        )
    other = member.post(
        "/courses", json={"name": "Empty", "faculty_id": member.get("/faculties").json()[0]["id"]}
    ).json()["id"]
    assert (
        member.post(
            f"/courses/{other}/attempts", json={"count": 1, "selection_mode": "ADAPTIVE"}
        ).status_code
        == 409
    )


def test_eligibility_type_filter_archive_deleted_and_snapshot(bank):
    owner, member, _, course, rows = bank
    add_progress(member, rows, {0: NOW - timedelta(days=1)})
    before = stored_progress()
    assert owner.post(f"/questions/{rows[0]['id']}/archive").status_code == 200
    with SessionLocal() as db:
        db.execute(delete(Question).where(Question.id == UUID(rows[1]["id"])))
        db.get(Question, UUID(rows[2]["id"])).status = "DRAFT"
        db.commit()
    response = member.post(
        f"/courses/{course}/attempts",
        json={"count": 1, "selection_mode": "ADAPTIVE", "question_types": ["TRUE_FALSE"]},
    )
    assert response.status_code == 409
    attempt = start(member, course, 5, selection_mode="ADAPTIVE", question_types=["SHORT_ANSWER"])
    assert ids(attempt) == [r["id"] for r in rows[3:]]
    assert stored_progress() == before
    path = save_all(member, course, attempt)
    for q in rows[3:]:
        owner.post(f"/questions/{q['id']}/archive")
    with SessionLocal() as db:
        db.get(Question, UUID(rows[3]["id"])).reference_answer = "My saved response"
        db.execute(delete(Question).where(Question.id == UUID(rows[4]["id"])))
        db.commit()
    assert member.get(path).json()["questions"][0]["stem"] == rows[3]["stem"]
    result = member.post(path + "/submit").json()
    assert all(q["grading_status"] == "PENDING" for q in result["questions"])
    assert member.post(path + "/submit").json() == result
    assert stored_progress() == before


def test_stable_ties_with_supplied_time(bank):
    _, member, _, course, rows = bank
    seed_seen(member, course, 4)
    add_progress(member, rows, {i: NOW for i in range(4)})
    with SessionLocal() as db:
        for q in db.scalars(select(Question)):
            q.created_at = NOW
        db.commit()
    user_id = UUID(member.get("/auth/me").json()["id"])
    with SessionLocal() as db:
        data = StartQuiz(count=8, selection_mode="ADAPTIVE")
        first = [str(q.id) for q in select_questions(db, user_id, UUID(course), data, NOW)]
        again = [str(q.id) for q in select_questions(db, user_id, UUID(course), data, NOW)]
    assert first == again == sorted(r["id"] for r in rows[:4]) + sorted(r["id"] for r in rows[4:])


def test_concurrent_adaptive_starts_do_not_duplicate(bank):
    _, member, _, course, rows = bank

    def request(_):
        with TestClient(app) as client:
            client.cookies.update(member.cookies)
            return start(client, course, 4, selection_mode="ADAPTIVE")

    with ThreadPoolExecutor(max_workers=2) as pool:
        attempts = list(pool.map(request, range(2)))
    selected = [set(ids(a)) for a in attempts]
    assert not selected[0] & selected[1]
    assert selected[0] | selected[1] == {r["id"] for r in rows}
    assert stored_progress() == []
