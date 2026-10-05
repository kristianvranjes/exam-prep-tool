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
from test_quiz_import import document

from alembic import command
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import User
from app.models.question import Question
from app.models.user_question_progress import UserQuestionProgress
from app.schemas.quiz import StartQuiz
from app.services import progress as progress_service
from app.services import quizzes
from app.services.quiz_selection import select_questions

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
        response = member.post(path + "/submit")
        assert response.status_code == 200, response.text
        assert response.json()["questions"][0]["grading_status"] == "PENDING"
        assert progress(member, course) == []
        assert stored() == before  # includes every timestamp and internal field
        after_summary = summary(member, course)
        assert {key: value for key, value in after_summary.items() if key != "as_of"} == {
            key: value for key, value in before_summary.items() if key != "as_of"
        }

    path = save_all(member, course, start(member, course))
    response = member.post(path + "/submit")
    assert response.status_code == 200, response.text
    grades = {q["type"]: q["grading_status"] for q in response.json()["questions"]}
    assert grades["SHORT_ANSWER"] == "PENDING"
    assert grades["MULTIPLE_CHOICE"] in {"CORRECT", "INCORRECT"}
    assert grades["TRUE_FALSE"] in {"CORRECT", "INCORRECT"}
    objective_ids = {q["id"] for q in rows if q["type"] != "SHORT_ANSWER"}
    scheduled = progress(member, course)
    assert {row["question_id"] for row in scheduled} == objective_ids
    assert all(row["resolved_review_count"] == 1 for row in scheduled)
    assert sum(row["correct_review_count"] for row in scheduled) == list(grades.values()).count(
        "CORRECT"
    )
    assert sum(row["incorrect_review_count"] for row in scheduled) == list(grades.values()).count(
        "INCORRECT"
    )
    assert summary(member, course)["resolved_review_count"] == 2


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
    assert set(rows[0]) == {
        "question_id",
        "is_actionable",
        "review_stage",
        "resolved_review_count",
        "correct_review_count",
        "incorrect_review_count",
        "last_result",
        "last_reviewed_at",
        "due_at",
    }
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


@pytest.mark.parametrize("delay", [timedelta(days=-1), timedelta(days=1)])
def test_archived_progress_retains_history_without_actionable_schedule(bank, delay):
    owner, member, _, course, rows = bank
    source = next(q for q in rows if q["type"] == "TRUE_FALSE")
    for correct in [True, False]:
        path = saved_boolean(member, course, source["correct_boolean"] == correct)
        assert member.post(path + "/submit").status_code == 200
    with SessionLocal() as db:
        db.execute(update(UserQuestionProgress).values(due_at=datetime.now(UTC) + delay))
        db.commit()
    before_rows = progress(member, course)
    before_summary = summary(member, course)
    assert before_rows[0]["is_actionable"] is True
    before_read = stored()
    assert review_question(owner, f"/questions/{source['id']}/archive").status_code == 200
    assert stored() == before_read
    assert progress(member, course) == [before_rows[0] | {"is_actionable": False}]
    after_summary = summary(member, course)
    assert after_summary == before_summary | {
        "as_of": after_summary["as_of"],
        "due_now": 0,
        "upcoming": 0,
        "next_due_at": None,
    }
    assert after_summary["reviewed_questions"] == 1
    assert after_summary["resolved_review_count"] == 2
    assert after_summary["correct_review_count"] == after_summary["incorrect_review_count"] == 1
    assert stored() == before_read


def test_mixed_actionable_schedule_preserves_all_history_and_orders_pages(bank, monkeypatch):
    owner, member, _, course, _ = bank
    body = document()
    boolean = next(q for q in body["questions"] if q["type"] == "TRUE_FALSE")
    body["questions"] = [dict(boolean, stem="Another objective question")]
    response = owner.post(f"/courses/{course}/questions/import", json=body)
    assert response.status_code == 201, response.text
    extra = response.json()[0]
    assert owner.post(f"/questions/{extra['id']}/submit").status_code == 200
    assert review_question(owner, f"/questions/{extra['id']}/approve").status_code == 200
    assert (
        member.post(save_all(member, course, start(member, course, 4)) + "/submit").status_code
        == 200
    )
    rows = progress(member, course)
    assert len(rows) == 3
    now = datetime(2030, 1, 2, 12, tzinfo=UTC)
    dates = [now, now - timedelta(days=1), now + timedelta(days=1)]
    with SessionLocal() as db:
        for row, due in zip(rows, dates, strict=True):
            db.execute(
                update(UserQuestionProgress)
                .where(UserQuestionProgress.question_id == UUID(row["question_id"]))
                .values(due_at=due)
            )
        db.commit()
    before_summary = summary(member, course)
    assert review_question(owner, f"/questions/{rows[1]['question_id']}/archive").status_code == 200

    class Clock:
        calls = 0

        @classmethod
        def now(cls, tz):
            assert tz == UTC
            cls.calls += 1
            return now

    monkeypatch.setattr(progress_service, "datetime", Clock)
    before_read = stored()
    data = summary(member, course)
    assert Clock.calls == 1
    assert datetime.fromisoformat(data["as_of"]) == now
    assert data["reviewed_questions"] == 3
    assert data["due_now"] == data["upcoming"] == 1
    assert datetime.fromisoformat(data["next_due_at"]) == now
    for key in (
        "resolved_review_count",
        "correct_review_count",
        "incorrect_review_count",
        "last_reviewed_at",
        "stage_counts",
    ):
        assert data[key] == before_summary[key]
    ordered = progress(member, course)
    assert [row["question_id"] for row in ordered] == [rows[i]["question_id"] for i in [0, 2, 1]]
    assert [row["is_actionable"] for row in ordered] == [True, True, False]
    path = f"/courses/{course}/review-progress"
    for offset in range(3):
        assert member.get(path + f"?limit=1&offset={offset}").json() == ordered[offset : offset + 1]
    assert stored() == before_read
    # Equal due times still paginate deterministically by source ID within availability.
    with SessionLocal() as db:
        db.execute(update(UserQuestionProgress).values(due_at=now))
        db.commit()
    tied = progress(member, course)
    assert [row["question_id"] for row in tied[:2]] == sorted(
        rows[i]["question_id"] for i in [0, 2]
    )
    assert tied[-1]["question_id"] == rows[1]["question_id"]
    assert all(row["is_actionable"] for row in tied[:2])


@pytest.mark.parametrize("mode", ["STANDARD", "ADAPTIVE"])
@pytest.mark.parametrize("own", [True, False])
@pytest.mark.parametrize("status", ["APPROVED", "DRAFT", "PENDING_REVIEW", "REJECTED", "ARCHIVED"])
def test_selection_and_progress_share_caller_lifecycle_eligibility(bank, mode, own, status):
    owner, member, _, course, rows = bank
    source = next(q for q in rows if q["type"] == "TRUE_FALSE")
    assert (
        member.post(
            saved_boolean(member, course, source["correct_boolean"]) + "/submit"
        ).status_code
        == 200
    )
    creator = member if own else owner
    with SessionLocal() as db:
        question = db.get(Question, UUID(source["id"]))
        question.created_by_user_id = UUID(creator.get("/auth/me").json()["id"])
        question.status = status
        db.commit()
    before_read = stored()
    actionable = status == "APPROVED" or (own and status in {"DRAFT", "PENDING_REVIEW"})
    (row,) = progress(member, course)
    assert row["is_actionable"] is actionable
    data = summary(member, course)
    assert data["reviewed_questions"] == data["resolved_review_count"] == 1
    assert data["correct_review_count"] == 1 and data["incorrect_review_count"] == 0
    assert data["due_now"] == 0
    assert data["upcoming"] == int(actionable)
    assert data["next_due_at"] == (row["due_at"] if actionable else None)
    user_id = UUID(member.get("/auth/me").json()["id"])
    with SessionLocal() as db:
        selected = select_questions(
            db,
            user_id,
            UUID(course),
            StartQuiz(count=1, question_types=["TRUE_FALSE"], selection_mode=mode),
            datetime.now(UTC),
        )
        assert [str(q.id) for q in selected] == ([source["id"]] if actionable else [])
    assert stored() == before_read


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
    assert progress(member, course)[0]["is_actionable"] is False
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
