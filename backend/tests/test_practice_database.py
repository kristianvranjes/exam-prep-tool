import os
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import UUID

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from test_materials import clients as clients
from test_quiz_import import document

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import CourseMembership
from app.models.question import Question, QuestionOption
from app.models.quiz import Answer, QuizQuestion
from app.services import quizzes

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


@pytest.fixture
def bank(clients):
    owner, member, stranger, course = clients
    rows = owner.post(f"/courses/{course}/questions/import", json=document()).json()
    for q in rows:
        assert owner.post(f"/questions/{q['id']}/submit").status_code == 200
        assert owner.post(f"/questions/{q['id']}/approve").status_code == 200
    return owner, member, stranger, course, rows


def start(member, course, count=3, **kwargs):
    response = member.post(f"/courses/{course}/attempts", json={"count": count, **kwargs})
    assert response.status_code == 201, response.text
    return response.json()


def payload(q):
    if q["type"] == "MULTIPLE_CHOICE":
        return {"type": q["type"], "option_position": 0}
    if q["type"] == "TRUE_FALSE":
        return {"type": q["type"], "value": False}
    return {"type": q["type"], "text": "My saved response"}


def save_all(member, course, attempt):
    path = f"/courses/{course}/attempts/{attempt['id']}"
    for q in attempt["questions"]:
        response = member.patch(f"{path}/answers/{q['id']}", json=payload(q))
        assert response.status_code == 200, response.text
    return path


def assert_no_keys(value):
    if isinstance(value, dict):
        assert (
            not {
                "is_correct",
                "correct_boolean",
                "reference_answer",
                "explanation",
                "snapshot",
                "grading_status",
                "grading_method",
                "grading_version",
                "correct_answer",
            }
            & value.keys()
        )
        for child in value.values():
            assert_no_keys(child)
    elif isinstance(value, list):
        for child in value:
            assert_no_keys(child)


def test_only_approved_and_selection(clients):
    owner, member, stranger, course = clients
    path = f"/courses/{course}/attempts"
    assert "Only 0" in member.post(path, json={"count": 1}).json()["detail"]
    rows = owner.post(f"/courses/{course}/questions/import", json=document()).json()
    for row in rows:
        assert member.post(path, json={"count": 1}).status_code == 409
        owner.post(f"/questions/{row['id']}/submit")
    assert member.post(path, json={"count": 1}).status_code == 409
    for row in rows:
        owner.post(f"/questions/{row['id']}/approve")
    for typ in ("MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"):
        attempt = start(member, course, 1, question_types=[typ])
        assert attempt["questions"][0]["type"] == typ
    assert member.post(path, json={"count": 4}).status_code == 409
    first = start(member, course)
    second = start(member, course)
    assert [q["stem"] for q in first["questions"]] == [q["stem"] for q in second["questions"]]
    owner.post(f"/questions/{rows[0]['id']}/archive")
    assert member.post(path, json={"count": 3}).status_code == 409


def test_authorization(bank):
    owner, member, stranger, course, _ = bank
    attempt = start(member, course)
    path = f"/courses/{course}/attempts/{attempt['id']}"
    answer_path = f"{path}/answers/{attempt['questions'][0]['id']}"
    with TestClient(app) as anonymous:
        assert anonymous.post(f"/courses/{course}/attempts", json={"count": 1}).status_code == 401
        assert anonymous.get(path).status_code == 401
    for other in (owner, stranger):
        assert other.get(path).status_code == 404
        assert other.patch(answer_path, json=payload(attempt["questions"][0])).status_code == 404
        assert other.post(path + "/submit").status_code == 404
    assert owner.get(f"/courses/{course}/attempts").json() == []
    assert stranger.get(f"/courses/{course}/attempts").status_code == 404
    other_course = member.post("/courses", json={"name": "Other"}).json()["id"]
    assert member.get(path.replace(course, other_course)).status_code == 404
    assert member.post(path.replace(course, other_course) + "/submit").status_code == 404
    assert (
        member.patch(
            answer_path.replace(course, other_course), json=payload(attempt["questions"][0])
        ).status_code
        == 404
    )
    assert member.post(f"/courses/{other_course}/attempts", json={"count": 1}).status_code == 409
    second = start(member, course)
    assert (
        member.patch(
            f"{path}/answers/{second['questions'][0]['id']}", json=payload(attempt["questions"][0])
        ).status_code
        == 404
    )
    with SessionLocal() as db:
        db.execute(
            delete(CourseMembership).where(
                CourseMembership.course_id == UUID(course),
                CourseMembership.user_id == UUID(member.get("/auth/me").json()["id"]),
            )
        )
        db.commit()
    assert member.get(path).status_code == 404


def test_save_submit_and_immutable_history(bank):
    owner, member, _, course, rows = bank
    for client in (owner, member):
        assert_no_keys(start(client, course))
    attempt = start(member, course)
    path = f"/courses/{course}/attempts/{attempt['id']}"
    assert member.post(path + "/submit").status_code == 409
    assert member.get(path).json()["status"] == "ACTIVE"
    save_all(member, course, attempt)
    readback = member.get(path).json()
    assert_no_keys(readback)
    for q in readback["questions"]:
        assert q["answer"] == payload(q)
    mcq = next(q for q in attempt["questions"] if q["type"] == "MULTIPLE_CHOICE")
    answer_path = f"{path}/answers/{mcq['id']}"
    assert (
        member.patch(
            answer_path, json={"type": "MULTIPLE_CHOICE", "option_position": 5}
        ).status_code
        == 422
    )
    assert member.patch(answer_path, json={"type": "TRUE_FALSE", "value": True}).status_code == 422
    assert (
        member.patch(
            answer_path, json={"type": "MULTIPLE_CHOICE", "option_position": 1}
        ).status_code
        == 200
    )
    assert member.get(path).json()["questions"]
    # Archive and even bypass the lifecycle with a DB source edit: snapshots stay intact.
    for q in rows:
        owner.post(f"/questions/{q['id']}/archive")
    with SessionLocal() as db:
        for q in db.scalars(select(Question)):
            q.stem = "Changed source " + str(q.id)
            q.explanation = "Changed answer explanation"
            if q.type == "TRUE_FALSE":
                q.correct_boolean = not q.correct_boolean
            elif q.type == "SHORT_ANSWER":
                q.reference_answer = "Changed reference answer"
        for option in db.scalars(select(QuestionOption)):
            option.text = "Changed option " + str(option.id)
            option.is_correct = not option.is_correct
        db.commit()
    before = member.get(path).json()
    assert all(not q["stem"].startswith("Changed source") for q in before["questions"])
    result = member.post(path + "/submit")
    assert result.status_code == 200, result.text
    result = result.json()
    assert result["status"] == "SUBMITTED" and result["submitted_at"]
    for q in result["questions"]:
        source = next(row for row in rows if row["stem"] == q["stem"])
        assert q["options"] == source["options"]
        assert q["correct_boolean"] == source["correct_boolean"]
        assert q["reference_answer"] == source["reference_answer"]
        assert q["explanation"] == source["explanation"]
        if q["type"] == "SHORT_ANSWER":
            assert q["grading_status"] == "PENDING" and q["reference_answer"]
        elif q["type"] == "TRUE_FALSE":
            assert q["grading_status"] == (
                "CORRECT" if q["correct_boolean"] is False else "INCORRECT"
            )
        else:
            assert q["grading_status"] == (
                "CORRECT" if q["options"][1]["is_correct"] else "INCORRECT"
            )
    assert member.post(path + "/submit").json() == result
    assert member.patch(answer_path, json=payload(mcq)).status_code == 409
    with SessionLocal() as db:
        db.execute(delete(Question))
        db.commit()
    assert member.get(path).json() == result


def test_submission_rolls_back_and_serializes(bank, monkeypatch):
    _, member, _, course, _ = bank
    attempt = start(member, course)
    path = save_all(member, course, attempt)
    original = quizzes.grade
    calls = 0

    def fail_second(*args):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("Injected grading failure")
        return original(*args)

    monkeypatch.setattr(quizzes, "grade", fail_second)
    with pytest.raises(RuntimeError, match="Injected"):
        member.post(path + "/submit")
    assert member.get(path).json()["status"] == "ACTIVE"
    with SessionLocal() as db:
        assert {a.grading_status for a in db.scalars(select(Answer))} == {"PENDING"}
        assert all(
            a.grading_method is None and a.grading_version is None
            for a in db.scalars(select(Answer))
        )
    monkeypatch.setattr(quizzes, "grade", original)

    # Separate clients/connections exercising actual PostgreSQL row locks.
    def submit_once(_):
        with TestClient(app) as client:
            client.cookies.update(member.cookies)
            return client.post(path + "/submit")

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(submit_once, range(2)))
    assert all(r.status_code == 200 for r in responses)
    assert responses[0].json() == responses[1].json()


def test_migration_metadata_parity():
    tables = {"quizzes", "quiz_questions", "quiz_attempts", "answers"}
    with engine.connect() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "include_object": lambda obj, name, type_, reflected, compare_to: (
                    type_ != "table" or name in tables
                )
            },
        )
        assert compare_metadata(context, Base.metadata) == []
    assert QuizQuestion.__table__.c.snapshot.nullable is False


@pytest.mark.parametrize("first_action", ["save", "submit"])
def test_save_submit_race(bank, monkeypatch, first_action):
    _, member, _, course, _ = bank
    attempt = start(member, course, 1, question_types=["TRUE_FALSE"])
    path = save_all(member, course, attempt)
    question = attempt["questions"][0]
    first_locked = Event()
    second_started = Event()
    release_first = Event()
    original = quizzes.load_attempt

    def controlled_load(*args):
        if first_locked.is_set():
            second_started.set()
            return original(*args)
        result = original(*args)
        first_locked.set()
        assert release_first.wait(10), "Timed out releasing first request"
        return result

    monkeypatch.setattr(quizzes, "load_attempt", controlled_load)

    def request(action):
        with TestClient(app) as client:
            client.cookies.update(member.cookies)
            if action == "submit":
                return client.post(path + "/submit")
            return client.patch(
                f"{path}/answers/{question['id']}", json={"type": "TRUE_FALSE", "value": True}
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(request, first_action)
        try:
            assert first_locked.wait(10), "First request did not lock attempt"
            second = pool.submit(request, "submit" if first_action == "save" else "save")
            assert second_started.wait(10), "Second request did not start"
        finally:
            release_first.set()
        first_response, second_response = first.result(timeout=10), second.result(timeout=10)
    assert first_response.status_code == 200
    assert second_response.status_code == (200 if first_action == "save" else 409)
    result = member.get(path).json()
    assert result["status"] == "SUBMITTED"
    saved = result["questions"][0]
    assert saved["answer"]["value"] is (first_action == "save")
    assert saved["grading_status"] == (
        "CORRECT" if saved["answer"]["value"] == saved["correct_boolean"] else "INCORRECT"
    )
    assert member.post(path + "/submit").json() == result
