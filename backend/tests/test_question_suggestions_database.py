import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID, uuid4

import pytest
import test_questions
from community_helpers import provision
from fastapi.testclient import TestClient
from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as OrmSession
from test_community_database import community as community
from test_community_database import contribute
from test_manual_questions_database import add_concept, body
from test_materials import clients as clients
from test_practice_database import save_all, start
from test_question_reports_database import BODY, approved, question_history, register

from app.database import SessionLocal, engine
from app.main import app
from app.models import User
from app.models.question import Question, QuestionConcept
from app.models.question_edit_suggestion import QuestionEditSuggestion
from app.services.questions import service as questions

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")
PROPOSAL = {"changes": {"difficulty": 3}, "note": "  Please review this difficulty  "}
ai_questions = test_questions.questions
retrieval_data = test_questions.retrieval_data


def submit(client, path, changes=None):
    response = client.post(path + "/suggestions", json=PROPOSAL if changes is None else changes)
    assert response.status_code == 201, response.text
    return response.json()


def queue(moderator, faculty, status="OPEN"):
    response = moderator.get(f"/faculties/{faculty}/question-suggestions?status={status}")
    assert response.status_code == 200, response.text
    return response.json()


def decide(moderator, row, action="approve", **kwargs):
    return moderator.post(f"/question-suggestions/{row['id']}/{action}", **kwargs)


def rows_for(question_id, table):
    with engine.connect() as conn:
        return conn.execute(
            text(f"SELECT * FROM {table} WHERE question_id = :id ORDER BY id"),
            {"id": UUID(str(question_id))},
        ).all()


def race(*requests):
    barrier = Barrier(len(requests))

    def request(item):
        client, path, data = item
        with TestClient(app) as separate:
            separate.cookies.update(client.cookies)
            barrier.wait(timeout=10)
            return separate.post(path, **({"json": data} if data is not None else {}))

    with ThreadPoolExecutor(max_workers=len(requests)) as pool:
        return list(pool.map(request, requests))


def test_creation_authorization_privacy_and_no_mutation(community):
    owner, creator, moderator, course, faculty, other = community
    path = approved(creator, moderator, course)
    with register() as outsider, TestClient(app) as anonymous:
        assert anonymous.post(path + "/suggestions", json=PROPOSAL).status_code == 401
        assert outsider.post(path + "/suggestions", json=PROPOSAL).status_code == 404
        assert moderator.post(path + "/suggestions", json=PROPOSAL).status_code == 404
        assert creator.post(path + "/reports", json=BODY).status_code == 201
        before = question_history(UUID(path.split("/")[2]))
        reports = rows_for(path.split("/")[2], "question_reports")
        for client in (owner, creator):
            receipt = submit(client, path)
            assert set(receipt) == {
                "id",
                "question_id",
                "base_version_number",
                "status",
                "created_at",
            }
            assert receipt["status"] == "OPEN" and receipt["base_version_number"] == 3
            assert client.post(path + "/suggestions", json=PROPOSAL).status_code == 409
        assert question_history(UUID(path.split("/")[2])) == before
        assert rows_for(path.split("/")[2], "question_reports") == reports
        assert owner.get(f"/faculties/{faculty}/question-suggestions").status_code == 403
        assert outsider.get(f"/faculties/{faculty}/question-suggestions").status_code == 403
        assert moderator.get(f"/faculties/{other}/question-suggestions").status_code == 403
        assert moderator.get(f"/faculties/{uuid4()}/question-suggestions").status_code == 404
        assert (
            moderator.get(f"/faculties/{faculty}/question-suggestions?status=INVALID").status_code
            == 422
        )
        assert (
            moderator.get(f"/faculties/{faculty}/question-suggestions?limit=51").status_code == 422
        )
        assert (
            moderator.get(f"/faculties/{faculty}/question-suggestions?offset=10001").status_code
            == 422
        )
        row = queue(moderator, faculty)[0]
        assert row["base_snapshot"] == creator.get(path + "/versions").json()[-1]["snapshot"]
        assert row["proposed_content"]["correct_answer"] is True
        assert row["note"] == "Please review this difficulty"
        assert row["suggested_by_user_id"] in (
            owner.get("/auth/me").json()["id"],
            creator.get("/auth/me").json()["id"],
        )
        assert not {"email", "password", "password_hash"} & row.keys()
        assert outsider.post(f"/question-suggestions/{row['id']}/approve").status_code == 403
        assert (
            owner.post(
                f"/question-suggestions/{row['id']}/reject", json={"reason": "No"}
            ).status_code
            == 403
        )


@pytest.mark.parametrize("state", ["DRAFT", "PENDING_REVIEW", "REJECTED", "ARCHIVED"])
def test_nonapproved_visibility_is_not_an_existence_oracle(community, state):
    owner, creator, moderator, course, _, _ = community
    row = contribute(creator, course, uuid4().hex)
    path = f"/questions/{row['id']}"
    if state != "DRAFT":
        assert creator.post(path + "/submit").status_code == 200
    if state == "REJECTED":
        assert moderator.post(path + "/reject", json={"reason": "Needs rework"}).status_code == 200
    if state == "ARCHIVED":
        assert moderator.post(path + "/approve").status_code == 200
        assert moderator.post(path + "/archive").status_code == 200
    assert creator.post(path + "/suggestions", json=PROPOSAL).status_code == 409
    assert owner.post(path + "/suggestions", json=PROPOSAL).status_code == 404
    assert moderator.post(path + "/suggestions", json=PROPOSAL).status_code == 404
    assert moderator.post(f"/courses/{course}/join").status_code == 200
    assert moderator.post(path + "/suggestions", json=PROPOSAL).status_code == 409


def test_sparse_validation_bounds_and_server_fields(community):
    owner, creator, moderator, course, _, _ = community
    path = approved(creator, moderator, course)
    invalid_changes = [
        {},
        {"stem": " "},
        {"stem": "x" * 401},
        {"stem": None},
        {"explanation": "x" * 2001},
        {"difficulty": 0},
        {"difficulty": 6},
        {"difficulty": True},
        {"difficulty": "3"},
        {"correct_answer": "true"},
        {"correct_answer": None},
        {"reference_answer": "No"},
        {"correct_option_position": 0},
        {"options": []},
        {"options": [{"position": 0, "text": "Changed"}]},
    ]
    invalid_changes += [
        {field: str(uuid4())}
        for field in (
            "type",
            "course_id",
            "created_by_user_id",
            "source",
            "ai_job_id",
            "concept_ids",
            "source_chunks",
            "status",
            "reviewed_at",
            "reviewed_by_user_id",
            "base_version_number",
            "created_at",
        )
    ]
    for changes in invalid_changes:
        assert owner.post(path + "/suggestions", json={"changes": changes}).status_code == 422
    for data in (
        PROPOSAL | {"note": " "},
        PROPOSAL | {"note": "x" * 1001},
        PROPOSAL | {"status": "OPEN"},
        PROPOSAL | {"suggested_by_user_id": str(uuid4())},
    ):
        assert owner.post(path + "/suggestions", json=data).status_code == 422
    assert (
        submit(owner, path, {"changes": {"difficulty": None}, "note": " " + "x" * 1000 + " "})[
            "status"
        ]
        == "OPEN"
    )


@pytest.mark.parametrize("type_", ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"])
def test_answer_proposals_have_no_equality_oracle_and_apply_exactly(community, type_):
    owner, creator, moderator, course, faculty, _ = community
    created = creator.post(
        f"/courses/{course}/questions", json=body(type_) | {"explanation": "Private explanation"}
    ).json()
    path = f"/questions/{created['id']}"
    assert creator.post(path + "/submit").status_code == 200
    assert moderator.post(path + "/approve").status_code == 200
    keys = {
        "MULTIPLE_CHOICE": ({"correct_option_position": 0}, {"correct_option_position": 1}),
        "TRUE_FALSE": ({"correct_answer": False}, {"correct_answer": True}),
        "SHORT_ANSWER": (
            {"reference_answer": "A reference answer"},
            {"reference_answer": "A revised reference"},
        ),
    }[type_]
    receipts = [
        submit(client, path, {"changes": proposal})
        for client, proposal in zip((owner, creator), keys, strict=True)
    ]
    assert receipts[0].keys() == receipts[1].keys()
    assert receipts[0]["status"] == receipts[1]["status"] == "OPEN"
    assert receipts[0]["base_version_number"] == receipts[1]["base_version_number"]
    if type_ == "MULTIPLE_CHOICE":
        for changes in (
            {"correct_option_position": 2},
            {"correct_option_position": -1},
            {"options": [{"position": 2, "text": "Extra"}]},
            {"options": [{"position": 0, "text": "A"}, {"position": 0, "text": "B"}]},
            {"options": [{"position": 0, "text": "Second"}]},
            {"options": [{"position": 0, "text": "A", "is_correct": True}]},
            {"correct_answer": True},
            {"reference_answer": "No"},
        ):
            assert owner.post(path + "/suggestions", json={"changes": changes}).status_code == 422
    before = creator.get(path).json()
    applied = decide(moderator, receipts[1])
    assert applied.status_code == 200, applied.text
    row = applied.json()
    assert row["resolution"] == "APPLIED" and row["applied_version_number"] == 4
    live = creator.get(path).json()
    assert live["status"] == "APPROVED" and live["rejection_reason"] is None
    assert live["reviewed_by_user_id"] == moderator.get("/auth/me").json()["id"]
    assert live["reviewed_at"] == row["resolved_at"]
    for field in (
        "id",
        "course_id",
        "type",
        "created_by_user_id",
        "source",
        "ai_job_id",
        "concept_ids",
        "source_chunks",
        "created_at",
    ):
        assert live[field] == before[field]
    if type_ == "MULTIPLE_CHOICE":
        assert [option["is_correct"] for option in live["options"]] == [False, True]
        assert [option["text"] for option in live["options"]] == ["First", "Second"]
    elif type_ == "TRUE_FALSE":
        assert live["correct_boolean"] is True
    else:
        assert live["reference_answer"] == "A revised reference"
    versions = creator.get(path + "/versions").json()
    assert len(versions) == 4 and versions[-1]["reason"] == "EDITED"
    assert versions[-1]["snapshot"] == live
    assert versions[-1]["changed_by_user_id"] == row["resolved_by_user_id"]
    resolved = queue(moderator, faculty, "RESOLVED")
    assert {item["resolution"] for item in resolved} == {"APPLIED", "SUPERSEDED"}


def test_queue_cross_course_filters_and_deterministic_pagination(community):
    owner, creator, moderator, course, faculty, other = community
    path = approved(creator, moderator, course)
    submit(owner, path)
    submit(creator, path)
    new_course = moderator.post(
        "/courses", json={"name": "Second suggestions course", "faculty_id": faculty}
    ).json()["id"]
    assert creator.post(f"/courses/{new_course}/join").status_code == 200
    second = approved(creator, moderator, new_course)
    third = submit(creator, second)
    endpoint = f"/faculties/{faculty}/question-suggestions"
    all_rows = queue(moderator, faculty)
    assert [r["question"]["course_id"] for r in all_rows] == [course, course, new_course]
    assert moderator.get(endpoint + "?limit=1&offset=1").json() == all_rows[1:2]
    assert len(moderator.get(endpoint + f"?course_id={course}").json()) == 2
    other_course = owner.post("/courses", json={"name": "Foreign", "faculty_id": other})
    # Trusted provisioning is required for course creation, so use an existing foreign faculty id
    # plus an unknown course and verify neither filter expands the assigned faculty scope.
    assert other_course.status_code == 403
    with SessionLocal() as db:
        from app.models import Course

        foreign = Course(
            name="Foreign",
            faculty_id=UUID(other),
            created_by_user_id=UUID(owner.get("/auth/me").json()["id"]),
        )
        db.add(foreign)
        db.commit()
        assert moderator.get(endpoint + f"?course_id={foreign.id}").status_code == 404
        assert moderator.get(endpoint + f"?course_id={uuid4()}").status_code == 404
        db.execute(delete(Course).where(Course.id == UUID(new_course)))
        db.commit()
        assert db.get(QuestionEditSuggestion, UUID(third["id"])) is None


def test_self_review_requires_another_moderator(community):
    _, creator, moderator, course, faculty, _ = community
    path = approved(creator, moderator, course)
    assert moderator.post(f"/courses/{course}/join").status_code == 200
    row = submit(moderator, path)
    assert any(item["id"] == row["id"] for item in queue(moderator, faculty))
    assert decide(moderator, row).status_code == 403
    assert decide(moderator, row, "reject", json={"reason": "No"}).status_code == 403
    with register() as reviewer:
        provision(reviewer, faculty)
        assert decide(reviewer, row).status_code == 200


def test_reject_isolated_then_new_suggestion_is_allowed(community):
    owner, creator, moderator, course, faculty, _ = community
    path = approved(creator, moderator, course)
    assert creator.post(path + "/reports", json=BODY).status_code == 201
    row = submit(creator, path)
    sibling = submit(owner, path)
    before = question_history(UUID(path.split("/")[2]))
    options = rows_for(path.split("/")[2], "question_options")
    reports = rows_for(path.split("/")[2], "question_reports")
    for reason in ("", " ", "x" * 1001):
        assert decide(moderator, row, "reject", json={"reason": reason}).status_code == 422
    rejected = decide(moderator, row, "reject", json={"reason": "  Not justified  "})
    assert rejected.status_code == 200
    assert rejected.json()["resolution"] == "REJECTED"
    assert rejected.json()["resolution_reason"] == "Not justified"
    assert rejected.json()["resolved_by_user_id"] == moderator.get("/auth/me").json()["id"]
    assert rejected.json()["resolved_at"] and rejected.json()["applied_version_number"] is None
    assert [item["id"] for item in queue(moderator, faculty)] == [sibling["id"]]
    assert question_history(UUID(path.split("/")[2])) == before
    assert rows_for(path.split("/")[2], "question_options") == options
    assert rows_for(path.split("/")[2], "question_reports") == reports
    assert decide(moderator, row).status_code == 409
    assert decide(moderator, row, "reject", json={"reason": "Again"}).status_code == 409
    assert submit(creator, path)["base_version_number"] == row["base_version_number"]


def test_apply_provenance_reports_siblings_and_frozen_attempts(community):
    owner, creator, moderator, course, faculty, _ = community
    path = approved(creator, moderator, course)
    concept = add_concept(course)
    with SessionLocal() as db:
        db.add(QuestionConcept(question_id=UUID(path.split("/")[2]), concept_id=UUID(concept)))
        db.commit()
    attempt = start(owner, course, 1)
    attempt_path = save_all(owner, course, attempt)
    result = owner.post(attempt_path + "/submit").json()
    with engine.connect() as conn:
        snapshots = conn.execute(text("SELECT id, snapshot FROM quiz_questions ORDER BY id")).all()
    assert creator.post(path + "/reports", json=BODY).status_code == 201
    reports = rows_for(path.split("/")[2], "question_reports")
    row = submit(
        creator,
        path,
        {
            "changes": {
                "stem": "Revised " + uuid4().hex,
                "correct_answer": False,
                "explanation": "New explanation",
                "difficulty": 5,
            }
        },
    )
    submit(owner, path)
    applied = decide(moderator, row)
    assert applied.status_code == 200, applied.text
    live = creator.get(path).json()
    assert live["concept_ids"] == [concept]
    assert live["difficulty"] == 5 and live["correct_boolean"] is False
    assert live["explanation"] == "New explanation"
    assert rows_for(path.split("/")[2], "question_reports") == reports
    assert queue(moderator, faculty) == []
    assert owner.get(attempt_path).json() == result
    with engine.connect() as conn:
        assert (
            conn.execute(text("SELECT id, snapshot FROM quiz_questions ORDER BY id")).all()
            == snapshots
        )
    new = submit(creator, path)
    assert new["base_version_number"] == 4
    assert moderator.post(path + "/archive").status_code == 200
    assert owner.get(attempt_path).json() == result


def test_sparse_option_text_apply_preserves_populated_ai_provenance(ai_questions):
    d = ai_questions
    created = next(row for row in test_questions.generated(d) if row["type"] == "MULTIPLE_CHOICE")
    path = f"/questions/{created['id']}"
    faculty = d.owner.get(f"/courses/{d.course}").json()["faculty_id"]
    provision(d.outsider, faculty)
    assert d.owner.post(path + "/submit").status_code == 200
    assert d.outsider.post(path + "/approve").status_code == 200
    before = d.owner.get(path).json()
    assert before["ai_job_id"] and before["concept_ids"] and before["source_chunks"]
    row = submit(
        d.member, path, {"changes": {"options": [{"position": 0, "text": "Revised first option"}]}}
    )
    assert decide(d.outsider, row).status_code == 200
    live = d.owner.get(path).json()
    assert live["options"][0]["text"] == "Revised first option"
    assert live["options"][1:] == before["options"][1:]
    assert [option["is_correct"] for option in live["options"]] == [
        option["is_correct"] for option in before["options"]
    ]
    for field in (
        "id",
        "course_id",
        "type",
        "created_by_user_id",
        "source",
        "ai_job_id",
        "concept_ids",
        "source_chunks",
        "created_at",
    ):
        assert live[field] == before[field]
    assert len(d.generator.calls) == 1
    assert d.owner.get(path + "/versions").json()[-1]["snapshot"] == live


def test_approval_commit_failure_rolls_back_all_completed_writes(community, monkeypatch):
    owner, creator, moderator, course, _, _ = community
    created = creator.post(f"/courses/{course}/questions", json=body("MULTIPLE_CHOICE")).json()
    path = f"/questions/{created['id']}"
    assert creator.post(path + "/submit").status_code == 200
    assert moderator.post(path + "/approve").status_code == 200
    row = submit(
        creator,
        path,
        {
            "changes": {
                "options": [{"position": 0, "text": "Replaced option"}],
                "correct_option_position": 1,
            }
        },
    )
    submit(owner, path)
    assert creator.post(path + "/reports", json=BODY).status_code == 201
    before = question_history(UUID(created["id"]))
    saved = {
        table: rows_for(created["id"], table)
        for table in ("question_options", "question_reports", "question_edit_suggestions")
    }

    def fail_commit(db):
        # All writes have been flushed and the moderator response built before commit.
        states = (
            db.execute(
                text("SELECT resolution FROM question_edit_suggestions WHERE question_id = :id"),
                {"id": UUID(created["id"])},
            )
            .scalars()
            .all()
        )
        assert set(states) == {"APPLIED", "SUPERSEDED"}
        assert (
            db.execute(
                text("SELECT max(version_number) FROM question_versions WHERE question_id = :id"),
                {"id": UUID(created["id"])},
            ).scalar()
            == 4
        )
        raise RuntimeError("private commit failure")

    monkeypatch.setattr(OrmSession, "commit", fail_commit)
    response = decide(moderator, row)
    assert response.status_code == 503 and "private" not in response.text
    monkeypatch.undo()
    assert question_history(UUID(created["id"])) == before
    for table, previous in saved.items():
        assert rows_for(created["id"], table) == previous


def test_approved_stem_conflict_and_stale_base_rollback(community):
    owner, creator, moderator, course, faculty, _ = community
    path = approved(creator, moderator, course)
    other = approved(creator, moderator, course)
    row = submit(
        creator,
        path,
        {"changes": {"stem": creator.get(other).json()["stem"], "correct_answer": False}},
    )
    submit(owner, path)
    before = question_history(UUID(path.split("/")[2]))
    before_rows = rows_for(path.split("/")[2], "question_edit_suggestions")
    assert decide(moderator, row).status_code == 409
    assert question_history(UUID(path.split("/")[2])) == before
    assert rows_for(path.split("/")[2], "question_edit_suggestions") == before_rows
    with SessionLocal() as db:
        question = db.get(Question, UUID(path.split("/")[2]))
        user = db.get(User, UUID(moderator.get("/auth/me").json()["id"]))
        questions.add_version(db, question, user, "EDITED")
        db.commit()
    assert decide(moderator, row).status_code == 409
    assert len(queue(moderator, faculty)) == 2


@pytest.mark.parametrize("action", ["create", "approve", "reject", "archive"])
def test_persistence_failures_roll_back_all_mutations(community, monkeypatch, action):
    owner, creator, moderator, course, faculty, _ = community
    path = approved(creator, moderator, course)
    row = submit(creator, path)
    submit(owner, path)
    assert creator.post(path + "/reports", json=BODY).status_code == 201
    before = question_history(UUID(path.split("/")[2]))
    saved = {
        table: rows_for(path.split("/")[2], table)
        for table in ("question_options", "question_reports", "question_edit_suggestions")
    }
    original_flush = OrmSession.flush
    original_version = questions.add_version

    def fail_flush(db, objects=None):
        if action == "create" and any(isinstance(item, QuestionEditSuggestion) for item in db.new):
            raise IntegrityError("insert", {}, Exception("private unexpected error"))
        if action == "reject" and any(
            isinstance(item, QuestionEditSuggestion) and item.status == "RESOLVED"
            for item in db.dirty
        ):
            raise RuntimeError("private injected error")
        return original_flush(db, objects)

    def fail_version(db, question, user, reason):
        original_version(db, question, user, reason)
        if action in ("approve", "archive"):
            raise RuntimeError("private injected error")

    monkeypatch.setattr(OrmSession, "flush", fail_flush)
    monkeypatch.setattr(questions, "add_version", fail_version)
    if action == "create":
        assert moderator.post(f"/courses/{course}/join").status_code == 200
        response = moderator.post(path + "/suggestions", json=PROPOSAL)
    elif action == "archive":
        response = moderator.post(path + "/archive")
    else:
        response = decide(
            moderator, row, action, **({"json": {"reason": "No"}} if action == "reject" else {})
        )
    assert response.status_code == 503, response.text
    assert "private" not in response.text
    assert question_history(UUID(path.split("/")[2])) == before
    for table, previous in saved.items():
        assert rows_for(path.split("/")[2], table) == previous


def test_archive_resolves_only_open_rows_at_one_timestamp(community):
    owner, creator, moderator, course, faculty, _ = community
    path = approved(creator, moderator, course)
    old = submit(creator, path)
    assert decide(moderator, old, "reject", json={"reason": "No"}).status_code == 200
    resolved_before = queue(moderator, faculty, "RESOLVED")[0]
    for client in (owner, creator):
        submit(client, path)
        assert client.post(path + "/reports", json=BODY).status_code == 201
    before = creator.get(path + "/versions").json()
    assert moderator.post(path + "/archive").status_code == 200
    assert queue(moderator, faculty) == []
    resolved = queue(moderator, faculty, "RESOLVED")
    assert (
        next(item for item in resolved if item["id"] == old["id"])["resolved_at"]
        == resolved_before["resolved_at"]
    )
    closed = [item for item in resolved if item["resolution"] == "QUESTION_ARCHIVED"]
    report_rows = moderator.get(f"/faculties/{faculty}/question-reports?status=RESOLVED").json()
    assert len(closed) == 2 and len(report_rows) == 2
    assert len({item["resolved_at"] for item in closed + report_rows}) == 1
    assert len(creator.get(path + "/versions").json()) == len(before) + 1
    assert creator.post(path + "/suggestions", json=PROPOSAL).status_code == 409


@pytest.mark.parametrize(
    "scenario",
    [
        "duplicate",
        "approve_twice",
        "approve_reject",
        "two_approvals",
        "approve_archive",
        "create_archive",
        "stem_race",
    ],
)
def test_concurrent_suggestion_decisions_use_database_locks(community, scenario):
    owner, creator, moderator, course, faculty, _ = community
    path = approved(creator, moderator, course)
    with register() as reviewer:
        provision(reviewer, faculty)
        if scenario in ("duplicate", "create_archive"):
            first = (creator, path + "/suggestions", PROPOSAL)
            second = first if scenario == "duplicate" else (reviewer, path + "/archive", None)
            outcomes = race(first, second)
            codes = sorted(item.status_code for item in outcomes)
            if scenario == "duplicate":
                assert codes == [201, 409]
                assert len(queue(moderator, faculty)) == 1
            else:
                assert outcomes[1].status_code == 200
                assert outcomes[0].status_code in (201, 409)
                assert queue(moderator, faculty) == []
                assert creator.get(path).json()["status"] == "ARCHIVED"
            return
        first = submit(creator, path)
        target = f"/question-suggestions/{first['id']}"
        before = creator.get(path + "/versions").json()
        if scenario == "stem_race":
            second_path = approved(creator, moderator, course)
            shared = "Concurrent unique stem " + uuid4().hex
            with SessionLocal() as db:
                existing = db.get(QuestionEditSuggestion, UUID(first["id"]))
                existing.proposed_content = existing.proposed_content | {"stem": shared}
                db.commit()
            second = submit(creator, second_path, {"changes": {"stem": shared}})
            other_target = f"/question-suggestions/{second['id']}/approve"
        elif scenario == "two_approvals":
            second = submit(owner, path, {"changes": {"difficulty": 5}})
            other_target = f"/question-suggestions/{second['id']}/approve"
        else:
            other_target = (
                path + "/archive"
                if scenario == "approve_archive"
                else target + ("/reject" if scenario == "approve_reject" else "/approve")
            )
        outcomes = race(
            (moderator, target + "/approve", None),
            (reviewer, other_target, {"reason": "No"} if scenario == "approve_reject" else None),
        )
        if scenario == "approve_archive":
            assert outcomes[1].status_code == 200
            assert outcomes[0].status_code in (200, 409)
            assert creator.get(path).json()["status"] == "ARCHIVED"
            assert queue(moderator, faculty) == []
        else:
            assert sorted(item.status_code for item in outcomes) == [200, 409]
            if scenario != "stem_race":
                assert len(creator.get(path + "/versions").json()) == len(before) + (
                    1
                    if any(
                        item.status_code == 200 and item.json()["resolution"] == "APPLIED"
                        for item in outcomes
                    )
                    else 0
                )
                assert queue(moderator, faculty) == []


def test_suggester_restrict_and_resolver_set_null_and_question_cascade(community):
    _, creator, moderator, course, faculty, _ = community
    path = approved(creator, moderator, course)
    with register() as proposer, register() as resolver:
        assert proposer.post(f"/courses/{course}/join").status_code == 200
        provision(resolver, faculty)
        proposer_id = UUID(proposer.get("/auth/me").json()["id"])
        resolver_id = UUID(resolver.get("/auth/me").json()["id"])
        row = submit(proposer, path)
        assert decide(resolver, row, "reject", json={"reason": "No"}).status_code == 200
    with SessionLocal() as db:
        with pytest.raises(IntegrityError):
            db.execute(delete(User).where(User.id == proposer_id))
        db.rollback()
        db.execute(delete(User).where(User.id == resolver_id))
        db.commit()
        saved = db.get(QuestionEditSuggestion, UUID(row["id"]))
        assert saved.status == "RESOLVED" and saved.resolved_by_user_id is None
        db.execute(delete(Question).where(Question.id == UUID(path.split("/")[2])))
        db.commit()
        db.expire_all()
        assert db.get(QuestionEditSuggestion, UUID(row["id"])) is None
