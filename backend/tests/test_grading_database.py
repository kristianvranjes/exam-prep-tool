import os
from uuid import UUID

import pytest
from alembic.config import Config
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from test_materials import clients as clients
from test_practice_database import assert_no_keys, save_all, start
from test_practice_database import bank as bank

from alembic import command
from app.database import SessionLocal, engine
from app.models.question import Question
from app.models.quiz import Answer
from app.services import quizzes
from app.services.grading import ALGORITHM_VERSION

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


@pytest.mark.parametrize("matches", [True, False])
def test_short_answer_snapshot_provenance_and_frozen_result(bank, monkeypatch, matches):
    _, member, _, course, rows = bank
    source = next(row for row in rows if row["type"] == "SHORT_ANSWER")
    attempt = start(member, course, 1, question_types=["SHORT_ANSWER"])
    path = f"/courses/{course}/attempts/{attempt['id']}"
    question = attempt["questions"][0]
    raw = " \t" + source["reference_answer"].upper().replace(" ", "  \n") + "\n "
    if not matches:
        raw = "  Materially different answer\n "
    payload = {"type": "SHORT_ANSWER", "text": raw}
    answer_path = f"{path}/answers/{question['id']}"
    saved = member.patch(answer_path, json=payload)
    assert saved.status_code == 200, saved.text
    assert_no_keys(saved.json())
    readback = member.get(path).json()
    assert_no_keys(readback)
    assert readback["questions"][0]["answer"] == payload
    with SessionLocal() as db:
        answer = db.scalar(select(Answer).where(Answer.attempt_id == UUID(attempt["id"])))
        assert answer.payload == payload
        assert answer.grading_method is None and answer.grading_version is None
        live = db.get(Question, UUID(source["id"]))
        # A mismatch must stay pending even when the live reference is changed to match it.
        live.reference_answer = "Changed reference" if matches else raw.strip()
        db.commit()
    response = member.post(path + "/submit")
    assert response.status_code == 200, response.text
    result = response.json()
    reviewed = result["questions"][0]
    assert reviewed["grading_status"] == "PENDING"
    assert reviewed["reference_answer"] == source["reference_answer"]
    assert reviewed["answer"] == payload
    with SessionLocal() as db:
        answer = db.scalar(select(Answer).where(Answer.attempt_id == UUID(attempt["id"])))
        assert answer.grading_status == "PENDING"
        assert answer.grading_method == "PENDING_SEMANTIC"
        assert answer.grading_version == ALGORITHM_VERSION
        frozen = (
            answer.payload,
            answer.grading_status,
            answer.grading_method,
            answer.grading_version,
            answer.updated_at,
        )

    def forbidden_regrade(*args):
        raise AssertionError("Repeated submission must not invoke the grader")

    monkeypatch.setattr(quizzes, "grade", forbidden_regrade)
    assert member.post(path + "/submit").json() == result
    assert member.get(path).json() == result
    assert member.patch(answer_path, json=payload).status_code == 409
    with SessionLocal() as db:
        answer = db.scalar(select(Answer).where(Answer.attempt_id == UUID(attempt["id"])))
        assert (
            answer.payload,
            answer.grading_status,
            answer.grading_method,
            answer.grading_version,
            answer.updated_at,
        ) == frozen


def test_phase7_backfill_and_roundtrip_preserve_history(bank, monkeypatch):
    _, member, _, course, rows = bank
    active = start(member, course)
    active_path = save_all(member, course, active)
    submitted_paths = []
    for value in (True, False):
        attempt = start(member, course)
        path = save_all(member, course, attempt)
        for q in attempt["questions"]:
            if q["type"] == "SHORT_ANSWER":
                reference = next(r["reference_answer"] for r in rows if r["type"] == q["type"])
                data = {"type": q["type"], "text": reference}
            elif q["type"] == "TRUE_FALSE":
                data = {"type": q["type"], "value": value}
            else:
                data = {"type": q["type"], "option_position": int(value)}
            assert member.patch(f"{path}/answers/{q['id']}", json=data).status_code == 200
        assert member.post(path + "/submit").status_code == 200
        submitted_paths.append(path)

    def stored_history():
        with engine.connect() as conn:
            return {
                "answers": conn.execute(
                    text(
                        "SELECT id, attempt_id, quiz_question_id, payload, "
                        "grading_status, updated_at "
                        "FROM answers ORDER BY id"
                    )
                ).all(),
                "attempts": conn.execute(
                    text(
                        "SELECT id, quiz_id, status, started_at, submitted_at "
                        "FROM quiz_attempts ORDER BY id"
                    )
                ).all(),
                # Columns shared by old revisions; 0021's paper points are tested separately.
                "snapshots": conn.execute(
                    text(
                        "SELECT id, quiz_id, position, source_question_id, source_version, "
                        "snapshot FROM quiz_questions ORDER BY id"
                    )
                ).all(),
            }

    config = Config("alembic.ini")
    try:
        command.downgrade(config, "0007")
        with engine.begin() as conn:
            # Model the real Phase 7 contract: even exact short answers were pending.
            conn.execute(
                text(
                    "UPDATE answers SET grading_status = 'PENDING' "
                    "WHERE payload->>'type' = 'SHORT_ANSWER'"
                )
            )
        before = stored_history()
        for _ in range(2):
            command.upgrade(config, "0008")
            assert stored_history() == before
            with engine.connect() as conn:
                grades = conn.execute(
                    text(
                        "SELECT a.grading_status, a.grading_method, a.grading_version, t.status "
                        "FROM answers a JOIN quiz_attempts t ON t.id = a.attempt_id"
                    )
                ).all()
            assert {g[0] for g in grades} == {"CORRECT", "INCORRECT", "PENDING"}
            for status, method, version, attempt_status in grades:
                if attempt_status == "ACTIVE":
                    assert method is None and version is None
                else:
                    assert method == (
                        "PENDING_SEMANTIC" if status == "PENDING" else "DETERMINISTIC"
                    )
                    assert version == "legacy-unversioned"
            command.downgrade(config, "0007")
            assert stored_history() == before
    finally:
        command.upgrade(config, "head")

    original = quizzes.grade

    def forbidden_regrade(*args):
        raise AssertionError("Legacy results must not be regraded")

    monkeypatch.setattr(quizzes, "grade", forbidden_regrade)
    for path in submitted_paths:
        result = member.get(path).json()
        short = next(q for q in result["questions"] if q["type"] == "SHORT_ANSWER")
        assert short["grading_status"] == "PENDING"
        assert member.post(path + "/submit").json() == result
    assert stored_history() == before
    monkeypatch.setattr(quizzes, "grade", original)
    assert member.post(active_path + "/submit").status_code == 200
    with SessionLocal() as db:
        assert {
            a.grading_version
            for a in db.scalars(select(Answer).where(Answer.attempt_id == UUID(active["id"])))
        } == {ALGORITHM_VERSION}


@pytest.mark.parametrize(
    "method,version",
    [
        ("DETERMINISTIC", None),
        (None, "deterministic-v1"),
        ("UNKNOWN", "v1"),
        ("PENDING_SEMANTIC", ""),
        ("DETERMINISTIC", "v1"),
    ],
)
def test_provenance_constraint(bank, method, version):
    _, member, _, course, _ = bank
    save_all(member, course, start(member, course))
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(
            text("UPDATE answers SET grading_method = :method, grading_version = :version"),
            {"method": method, "version": version},
        )
