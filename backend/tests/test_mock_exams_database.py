import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from alembic.config import Config
from sqlalchemy import text, update
from test_exam_scopes_database import draft, scope, unit
from test_materials import clients as clients
from test_selection_mode_database import recorded

from alembic import command
from app.database import SessionLocal, engine
from app.models.quiz import QuizAttempt

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

TYPES = ["TRUE_FALSE"]


def mock_exam(client, course, scope_id, **body):
    payload = {"exam_scope_id": scope_id, "question_types": TYPES} | body
    return client.post(f"/courses/{course}/mock-exams", json=payload)


def started(client, course, scope_id, **body):
    response = mock_exam(client, course, scope_id, **body)
    assert response.status_code == 201, response.text
    return response.json()


def hand_in(client, course, attempt, right, wrong):
    """Answer the first `right` questions correctly and the next `wrong` ones wrongly."""
    path = f"/courses/{course}/attempts/{attempt['id']}"
    for index, question in enumerate(attempt["questions"][: right + wrong]):
        body = {"type": "TRUE_FALSE", "value": index < right}
        assert client.patch(f"{path}/answers/{question['id']}", json=body).status_code == 200
    response = client.post(f"{path}/submit")
    assert response.status_code == 200, response.text
    return response.json()


def last_mock(client, course):
    response = client.get(f"/courses/{course}/dashboard")
    assert response.status_code == 200, response.text
    return response.json()["last_mock"]


def unchanged(client, course, exam):
    """The attempt reads as it was started, apart from the server clock."""
    now = client.get(f"/courses/{course}/attempts/{exam['id']}").json()
    return now | {"server_time": None} == exam | {"server_time": None}


def stocked(clients, questions):
    owner, member, _, course = clients
    first = unit(owner, course, "Unit 1")
    second = unit(owner, course, "Unit 2")
    for number in range(questions):
        draft(member, course, f"Q{number:02d}?", [first if number % 2 == 0 else second])
    midterm = scope(
        owner, course, academic_year="2025/26", kind="MIDTERM", name="MI", unit_ids=[first, second]
    )
    return member, course, midterm["id"]


def test_a_mock_exam_may_be_larger_than_generated_practice_and_is_scored_by_points(clients):
    member, course, scope_id = stocked(clients, 24)
    exam = started(member, course, scope_id, count=22, duration_minutes=45)
    assert len(exam["questions"]) == 22
    assert {question["points"] for question in exam["questions"]} == {1.0}
    assert exam["paper"] == {
        "exam_paper_id": None,
        "title": "Probni ispit · MI 2025/26",
        "total_points": 22.0,
        "wrong_answer_penalty": 0.0,
        "pass_threshold": None,
        "duration_minutes": 45,
    }
    assert exam["exam_scope_id"] == scope_id and exam["focus_label"] == "MI 2025/26"
    assert exam["feedback_mode"] == "END"
    opened = datetime.fromisoformat(exam["started_at"])
    assert datetime.fromisoformat(exam["deadline_at"]) - opened == timedelta(minutes=45)
    assert exam["server_time"] is not None

    result = hand_in(member, course, exam, right=7, wrong=3)
    # Wrong answers cost nothing, blanks are counted, and there is no pass mark.
    assert result["score"]["earned"] == 7 and result["score"]["max_points"] == 22
    assert result["score"]["penalty_points"] == 0 and result["score"]["passed"] is None
    assert result["score"]["unanswered_count"] == 12


def test_limits_apply_to_the_exam_and_generated_practice_stays_small(clients):
    member, course, scope_id = stocked(clients, 4)
    assert mock_exam(member, course, scope_id, count=61).status_code == 422
    assert mock_exam(member, course, scope_id, count=0).status_code == 422
    assert mock_exam(member, course, scope_id, duration_minutes=0).status_code == 422
    assert mock_exam(member, course, scope_id, duration_minutes=601).status_code == 422
    assert mock_exam(member, course, scope_id, question_types=[]).status_code == 422
    assert mock_exam(member, course, scope_id, exam_scope_id=None).status_code == 422
    short = mock_exam(member, course, scope_id, count=5)
    assert short.status_code == 409 and "Only 4 eligible" in short.json()["detail"]

    practice = f"/courses/{course}/attempts"
    body = {"count": 21, "question_types": TYPES}
    assert member.post(practice, json=body | {"selection_mode": "ADAPTIVE"}).status_code == 422
    assert member.post(practice, json=body | {"selection_mode": "STANDARD"}).status_code == 422


def test_without_a_duration_the_exam_has_no_deadline_and_a_late_save_is_refused_with_one(clients):
    member, course, scope_id = stocked(clients, 6)
    untimed = started(member, course, scope_id, count=3)
    assert untimed["deadline_at"] is None and untimed["paper"]["duration_minutes"] is None
    assert hand_in(member, course, untimed, right=3, wrong=0)["score"]["earned"] == 3

    timed = started(member, course, scope_id, count=3, duration_minutes=10)
    with SessionLocal() as db:
        db.execute(
            update(QuizAttempt)
            .where(QuizAttempt.id == UUID(timed["id"]))
            .values(
                started_at=datetime.now(UTC) - timedelta(hours=2),
                deadline_at=datetime.now(UTC) - timedelta(seconds=1),
            )
        )
        db.commit()
    path = f"/courses/{course}/attempts/{timed['id']}"
    question = timed["questions"][0]
    late = member.patch(
        f"{path}/answers/{question['id']}", json={"type": "TRUE_FALSE", "value": True}
    )
    assert late.status_code == 409 and "Time is up" in late.json()["detail"]
    # Handing in an empty exam after the time ran out is still allowed.
    assert member.post(f"{path}/submit").json()["score"]["earned"] == 0


def test_the_dashboard_gives_the_latest_finished_scored_mock_exam(clients):
    owner, *_ = clients
    member, course, scope_id = stocked(clients, 12)
    assert last_mock(member, course) is None

    unfinished = started(member, course, scope_id, count=4)
    assert last_mock(member, course) is None
    assert member.post(f"/courses/{course}/attempts/{unfinished['id']}/abandon").status_code == 200

    first = started(member, course, scope_id, count=8, duration_minutes=30)
    hand_in(member, course, first, right=5, wrong=1)
    earlier = last_mock(member, course)
    assert earlier["attempt_id"] == first["id"] and earlier["title"] == "Probni ispit · MI 2025/26"
    assert (earlier["earned"], earlier["max_points"]) == (5, 8)

    second = started(member, course, scope_id, count=4)
    hand_in(member, course, second, right=3, wrong=0)
    latest = last_mock(member, course)
    assert latest["attempt_id"] == second["id"]
    assert (latest["earned"], latest["max_points"]) == (3, 4)
    assert datetime.fromisoformat(latest["submitted_at"]) > datetime.fromisoformat(
        earlier["submitted_at"]
    )

    # Mock practice started the old way has no points, so it never becomes the last mock exam.
    body = {
        "count": 3,
        "question_types": TYPES,
        "selection_mode": "MOCK",
        "exam_scope_id": scope_id,
    }
    practice = member.post(f"/courses/{course}/attempts", json=body).json()
    assert practice["paper"] is None
    hand_in(member, course, practice, right=3, wrong=0)
    assert last_mock(member, course)["attempt_id"] == second["id"]

    # Nobody sees anyone else's mock exam.
    assert last_mock(owner, course) is None


def test_0030_roundtrip_keeps_a_scored_mock_exam_and_forgets_only_its_recorded_mode(clients):
    member, course, scope_id = stocked(clients, 6)
    exam = started(member, course, scope_id, count=4, duration_minutes=20)
    config = Config("alembic.ini")
    try:
        for _ in range(2):
            command.downgrade(config, "0029")
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0029"
            # The strict rule is back, so the session keeps its scoring but loses its mode.
            assert recorded(exam) is None
            # Read in SQL: the models already know the column this downgrade removed.
            with engine.connect() as conn:
                assert conn.scalar(
                    text(
                        "SELECT q.scoring IS NOT NULL FROM quizzes q"
                        " JOIN quiz_attempts a ON a.quiz_id = q.id WHERE a.id = :id"
                    ),
                    {"id": exam["id"]},
                )
            command.upgrade(config, "head")
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0033"
            assert unchanged(member, course, exam)
            # Submitted again after the roundtrip, a new exam records its mode as before.
            assert member.post(f"/courses/{course}/attempts/{exam['id']}/submit").status_code == 200
            exam = started(member, course, scope_id, count=4, duration_minutes=20)
            assert recorded(exam) == "MOCK"
    finally:
        command.upgrade(config, "head")
