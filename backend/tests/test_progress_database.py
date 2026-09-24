import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Event
from uuid import UUID, uuid4

import pytest
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from community_helpers import create_course, review_question
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import IntegrityError
from test_materials import clients as clients
from test_practice_database import bank as bank
from test_practice_database import save_all, start

from alembic import command
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import User
from app.models.question import Question
from app.models.user_question_progress import UserQuestionProgress
from app.services import quizzes

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def progress(client, course):
    response = client.get(f"/courses/{course}/review-progress")
    assert response.status_code == 200, response.text
    return response.json()


def summary(client, course):
    response = client.get(f"/courses/{course}/review-progress/summary")
    assert response.status_code == 200, response.text
    return response.json()


def saved_boolean(member, course, value):
    attempt = start(member, course, 1, question_types=["TRUE_FALSE"])
    path = save_all(member, course, attempt)
    response = member.patch(
        f"{path}/answers/{attempt['questions'][0]['id']}",
        json={"type": "TRUE_FALSE", "value": value},
    )
    assert response.status_code == 200
    return path


def stored():
    with engine.connect() as conn:
        return conn.execute(text("SELECT * FROM question_review_progress ORDER BY id")).all()


def test_progression_counters_reset_and_frozen_repeat(bank):
    _, member, _, course, rows = bank
    source = next(q for q in rows if q["type"] == "TRUE_FALSE")
    assert source["concept_ids"] == []
    for count, (correct, stage, delay) in enumerate(
        [
            (True, 1, timedelta(days=1)),
            (True, 2, timedelta(days=3)),
            (False, 0, timedelta(minutes=10)),
            (True, 1, timedelta(days=1)),
        ],
        1,
    ):
        path = saved_boolean(member, course, source["correct_boolean"] == correct)
        response = member.post(path + "/submit")
        assert response.status_code == 200, response.text
        result = response.json()
        state = progress(member, course)
        assert len(state) == 1
        row = state[0]
        assert row["question_id"] == source["id"]
        assert row["review_stage"] == stage
        assert row["resolved_review_count"] == count
        assert row["correct_review_count"] == count - int(count >= 3)
        assert row["incorrect_review_count"] == int(count >= 3)
        assert row["last_result"] == ("CORRECT" if correct else "INCORRECT")
        submitted = datetime.fromisoformat(result["submitted_at"])
        assert datetime.fromisoformat(row["last_reviewed_at"]) == submitted
        assert datetime.fromisoformat(row["due_at"]) == submitted + delay
        before = stored()
        summary_before = summary(member, course)
        assert member.post(path + "/submit").json() == result
        assert member.get(path).json() == result
        assert stored() == before
        unchanged = summary(member, course)
        assert {key: value for key, value in unchanged.items() if key != "as_of"} == {
            key: value for key, value in summary_before.items() if key != "as_of"
        }


def test_pending_strict_noop_and_mixed_quiz(bank):
    _, member, _, course, rows = bank
    path = save_all(member, course, start(member, course))
    assert member.post(path + "/submit").status_code == 200
    assert len(progress(member, course)) == 2  # unresolved short answer creates nothing
    assert summary(member, course)["reviewed_questions"] == 2
    source = next(q for q in rows if q["type"] == "SHORT_ANSWER")
    for answer in [source["reference_answer"], "Unresolved answer"]:
        attempt = start(member, course, 1, question_types=["SHORT_ANSWER"])
        path = save_all(member, course, attempt)
        member.patch(
            f"{path}/answers/{attempt['questions'][0]['id']}",
            json={"type": "SHORT_ANSWER", "text": answer},
        )
        before = stored()
        before_summary = summary(member, course)
        assert member.post(path + "/submit").status_code == 200
        if answer != source["reference_answer"]:
            assert stored() == before  # includes every timestamp and internal field
            after_summary = summary(member, course)
            assert {key: value for key, value in after_summary.items() if key != "as_of"} == {
                key: value for key, value in before_summary.items() if key != "as_of"
            }
    assert len(progress(member, course)) == 3


def test_submission_rollback_restores_existing_and_new_progress(bank, monkeypatch):
    _, member, _, course, _ = bank
    path = saved_boolean(member, course, False)
    assert member.post(path + "/submit").status_code == 200
    before = stored()
    path = save_all(member, course, start(member, course))
    original = quizzes.apply_reviews

    def fail_after_progress(db, *args):
        original(db, *args)
        db.flush()
        raise RuntimeError("Injected failure after progress flush")

    monkeypatch.setattr(quizzes, "apply_reviews", fail_after_progress)
    with pytest.raises(RuntimeError, match="Injected failure"):
        member.post(path + "/submit")
    assert stored() == before
    result = member.get(path).json()
    assert result["status"] == "ACTIVE" and result["submitted_at"] is None
    with engine.connect() as conn:
        assert (
            conn.execute(
                text(
                    "SELECT grading_status, grading_method, grading_version FROM answers "
                    "WHERE attempt_id = :id"
                ),
                {"id": UUID(path.rsplit("/", 1)[1])},
            ).all()
            == [("PENDING", None, None)] * 3
        )


@pytest.mark.parametrize("same_attempt", [True, False])
@pytest.mark.parametrize("existing", [True, False])
def test_concurrent_submissions_and_overlapping_attempts(bank, monkeypatch, same_attempt, existing):
    _, member, _, course, rows = bank
    correct = next(q["correct_boolean"] for q in rows if q["type"] == "TRUE_FALSE")
    if existing:
        assert member.post(saved_boolean(member, course, correct) + "/submit").status_code == 200
    first_path = saved_boolean(member, course, correct)
    second_path = first_path if same_attempt else saved_boolean(member, course, correct)
    locked, second_started, release = Event(), Event(), Event()
    original = quizzes.apply_reviews

    def controlled_apply(*args):
        locked.set()  # first holds both the attempt and user locks
        assert release.wait(10)
        return original(*args)

    monkeypatch.setattr(quizzes, "apply_reviews", controlled_apply)

    def send(path, second=False):
        with TestClient(app) as client:
            client.cookies.update(member.cookies)
            if second:
                second_started.set()
            return client.post(path + "/submit")

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(send, first_path)
        try:
            assert locked.wait(10)
            second = pool.submit(send, second_path, True)
            assert second_started.wait(10)
        finally:
            release.set()
        responses = [first.result(timeout=15), second.result(timeout=15)]
    assert all(r.status_code == 200 for r in responses)
    if same_attempt:
        assert responses[0].json() == responses[1].json()
    (row,) = progress(member, course)
    expected = int(existing) + (1 if same_attempt else 2)
    assert row["resolved_review_count"] == row["correct_review_count"] == expected
    assert row["incorrect_review_count"] == 0 and row["review_stage"] == expected
    assert datetime.fromisoformat(row["last_reviewed_at"]) == max(
        datetime.fromisoformat(r.json()["submitted_at"]) for r in responses
    )


def test_private_course_scoped_api_and_pagination(bank):
    owner, member, stranger, course, _ = bank
    assert (
        member.post(save_all(member, course, start(member, course)) + "/submit").status_code == 200
    )
    path = f"/courses/{course}/review-progress"
    member_id = member.get("/auth/me").json()["id"]
    assert owner.get(path + f"?user_id={member_id}").json() == []
    assert stranger.get(path).status_code == 404
    assert stranger.get(path + "/summary").status_code == 404
    with TestClient(app) as anonymous:
        assert anonymous.get(path).status_code == 401
        assert anonymous.get(path + "/summary").status_code == 401
    assert member.get(f"/courses/{uuid4()}/review-progress").status_code == 404
    assert member.get(f"/courses/{uuid4()}/review-progress/summary").status_code == 404
    other = create_course(
        owner,
        json={"name": "Other course", "faculty_id": owner.get("/faculties").json()[0]["id"]},
    ).json()["id"]
    assert member.get(f"/courses/{other}/review-progress").status_code == 404
    assert member.get(f"/courses/{other}/review-progress/summary").status_code == 404
    assert owner.get(f"/courses/{other}/review-progress").json() == []
    empty = summary(owner, other)
    assert empty == {
        "as_of": empty["as_of"],
        "reviewed_questions": 0,
        "due_now": 0,
        "upcoming": 0,
        "resolved_review_count": 0,
        "correct_review_count": 0,
        "incorrect_review_count": 0,
        "last_reviewed_at": None,
        "next_due_at": None,
        "stage_counts": [{"review_stage": stage, "question_count": 0} for stage in range(6)],
    }
    assert datetime.fromisoformat(empty["as_of"]).tzinfo is not None
    rows = progress(member, course)
    assert rows == sorted(rows, key=lambda r: (r["due_at"], r["question_id"]))
    assert member.get(path + "?limit=1&offset=1").json() == rows[1:2]
    assert member.get(path + "?limit=0").status_code == 422
    assert not {"snapshot", "correct_boolean", "scheduling_version", "user_id"} & rows[0].keys()
    assert owner.post(save_all(owner, course, start(owner, course)) + "/submit").status_code == 200
    assert all(r["resolved_review_count"] == 1 for r in progress(owner, course))
    assert progress(member, course) == rows
    assert summary(owner, course)["reviewed_questions"] == len(progress(owner, course))
    assert summary(member, course)["reviewed_questions"] == len(rows)


def test_summary_aggregates_current_member_rows_with_server_clock(bank):
    _, member, _, course, _ = bank
    assert (
        member.post(save_all(member, course, start(member, course)) + "/submit").status_code == 200
    )
    rows = progress(member, course)
    assert len(rows) == 2
    with SessionLocal() as db:
        db.execute(
            update(UserQuestionProgress)
            .where(UserQuestionProgress.question_id == UUID(rows[0]["question_id"]))
            .values(due_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        db.commit()
    rows = progress(member, course)
    data = summary(member, course)
    as_of = datetime.fromisoformat(data["as_of"])
    assert data["reviewed_questions"] == len(rows)
    assert data["due_now"] == sum(datetime.fromisoformat(row["due_at"]) <= as_of for row in rows)
    assert data["upcoming"] == sum(datetime.fromisoformat(row["due_at"]) > as_of for row in rows)
    for name in ("resolved_review_count", "correct_review_count", "incorrect_review_count"):
        assert data[name] == sum(row[name] for row in rows)
    assert data["last_reviewed_at"] == max(row["last_reviewed_at"] for row in rows)
    assert data["next_due_at"] == min(row["due_at"] for row in rows)
    assert data["stage_counts"] == [
        {
            "review_stage": stage,
            "question_count": sum(row["review_stage"] == stage for row in rows),
        }
        for stage in range(6)
    ]
    assert (
        not {"user_id", "scheduling_version", "snapshot", "correct_boolean", "grading_status", "id"}
        & data.keys()
    )


def test_snapshot_archive_and_deleted_source(bank):
    owner, member, _, course, rows = bank
    source = next(q for q in rows if q["type"] == "TRUE_FALSE")
    path = saved_boolean(member, course, source["correct_boolean"])
    deleted_path = saved_boolean(member, course, source["correct_boolean"])
    assert review_question(owner, f"/questions/{source['id']}/archive").status_code == 200
    with SessionLocal() as db:
        db.get(Question, UUID(source["id"])).correct_boolean = not source["correct_boolean"]
        db.commit()
    result = member.post(path + "/submit").json()
    assert result["questions"][0]["grading_status"] == "CORRECT"
    assert progress(member, course)[0]["last_result"] == "CORRECT"
    assert summary(member, course)["reviewed_questions"] == 1
    with SessionLocal() as db:
        db.execute(delete(Question).where(Question.id == UUID(source["id"])))
        db.commit()
    assert progress(member, course) == []
    assert summary(member, course)["reviewed_questions"] == 0
    assert member.get(path).json() == result
    assert (
        member.post(deleted_path + "/submit").json()["questions"][0]["grading_status"] == "CORRECT"
    )
    assert progress(member, course) == []


@pytest.mark.parametrize("target", ["course", "user"])
def test_deletion_cascades(bank, target):
    owner, member, _, course, _ = bank
    assert member.post(saved_boolean(member, course, False) + "/submit").status_code == 200
    assert stored()
    if target == "course":
        assert owner.delete(f"/courses/{course}").status_code == 204
    else:
        user_id = UUID(member.get("/auth/me").json()["id"])
        with SessionLocal() as db:
            db.execute(delete(User).where(User.id == user_id))
            db.commit()
    assert stored() == []


def test_migration_no_backfill_preserves_frozen_history_and_metadata(bank):
    _, member, _, course, _ = bank
    path = saved_boolean(member, course, False)
    frozen = member.post(path + "/submit").json()
    config = Config("alembic.ini")
    try:
        for _ in range(2):
            command.downgrade(config, "0008")
            command.upgrade(config, "head")
            assert stored() == []
            assert member.post(path + "/submit").json() == frozen
            assert stored() == []
    finally:
        command.upgrade(config, "head")
    with engine.connect() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "include_object": lambda obj, name, type_, reflected, compare_to: (
                    type_ != "table" or name == "question_review_progress"
                )
            },
        )
        assert compare_metadata(context, Base.metadata) == []
    assert member.post(saved_boolean(member, course, False) + "/submit").status_code == 200
    assert progress(member, course)[0]["resolved_review_count"] == 1


@pytest.mark.parametrize(
    "assignment",
    [
        "review_stage = 6",
        "review_stage = -1",
        "last_result = 'PENDING'",
        "resolved_review_count = 0",
        "correct_review_count = -1",
        "scheduling_version = ''",
    ],
)
def test_progress_constraints(bank, assignment):
    _, member, _, course, _ = bank
    assert member.post(saved_boolean(member, course, False) + "/submit").status_code == 200
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text("UPDATE question_review_progress SET " + assignment))
    with SessionLocal() as db:
        row = db.scalar(select(UserQuestionProgress))
        copy = {c.name: getattr(row, c.name) for c in UserQuestionProgress.__table__.columns}
        copy["id"] = uuid4()
        db.add(UserQuestionProgress(**copy))
        with pytest.raises(IntegrityError):
            db.flush()
