import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from community_helpers import provision
from fastapi.testclient import TestClient
from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError
from test_materials import clients as clients
from test_practice_database import assert_no_keys, save_all, start
from test_quiz_import import document

from alembic import command
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models.faculty import Faculty
from app.models.faculty_moderator import FacultyModerator

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


@pytest.fixture
def community(clients):
    owner, creator, moderator, course = clients
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    with SessionLocal() as db:
        db.execute(delete(FacultyModerator))  # OWNER is deliberately not a moderator.
        other = Faculty(name="Other faculty", slug="other-" + uuid4().hex)
        db.add(other)
        db.commit()
        other_id = str(other.id)
    provision(moderator, faculty)
    return owner, creator, moderator, course, faculty, other_id


def contribute(client, course, stem="Private statement"):
    body = document()
    body["questions"] = [{"type": "TRUE_FALSE", "stem": stem, "correct_answer": True}]
    response = client.post(f"/courses/{course}/questions/import", json=body)
    assert response.status_code == 201, response.text
    return response.json()[0]


def test_private_lifecycle_queue_and_scoped_authority(community):
    owner, creator, moderator, course, faculty, other = community
    row = contribute(creator, course)
    path = f"/questions/{row['id']}"
    queue = f"/faculties/{faculty}/question-review"
    assert creator.get(path).json()["correct_boolean"] is True
    for state in ("DRAFT", "PENDING_REVIEW", "REJECTED"):
        if state == "PENDING_REVIEW":
            assert creator.post(path + "/submit").status_code == 200
            queued = moderator.get(queue).json()
            assert [r["id"] for r in queued] == [row["id"]]
            assert queued[0]["correct_boolean"] is True
            assert moderator.patch(path, json={"stem": "No silent edit"}).status_code in (403, 404)
        if state == "REJECTED":
            rejected = moderator.post(path + "/reject", json={"reason": "Needs rework"}).json()
            assert rejected["reviewed_by_user_id"] == moderator.get("/auth/me").json()["id"]
            assert rejected["reviewed_at"] and rejected["rejection_reason"] == "Needs rework"
        assert creator.get(path).json()["status"] == state
        assert creator.get(path + "/versions").status_code == 200
        for suffix in ("", "/versions"):
            assert owner.get(path + suffix).status_code == 404
        assert owner.get(f"/courses/{course}/questions?status={state}").json() == []
        assert creator.post(path + "/approve").status_code == 403
        assert creator.post(path + "/reject", json={"reason": "Self"}).status_code == 403
    assert creator.get(queue).status_code == 403
    assert owner.get(queue).status_code == 403
    assert moderator.get(f"/faculties/{other}/question-review").status_code == 403
    # Giving OWNER a different faculty role must not reveal this faculty's private questions.
    provision(owner, other)
    assert owner.get(path).status_code == 404
    assert owner.post(path + "/approve").status_code == 404
    assert creator.patch(path, json={"stem": "Reworked"}).json()["status"] == "DRAFT"
    assert creator.post(path + "/submit").status_code == 200
    assert moderator.post(path + "/approve").status_code == 200
    public = owner.get(path).json()
    assert public["visibility"] == "MEMBER"
    assert "correct_boolean" not in public and "explanation" not in public
    assert owner.get(path + "/versions").status_code == 403
    assert owner.post(path + "/archive").status_code == 403
    assert moderator.post(path + "/archive").json()["status"] == "ARCHIVED"
    assert creator.get(path).status_code == 200
    assert owner.get(path).status_code == 404


@pytest.mark.parametrize("mode", ["STANDARD", "ADAPTIVE"])
def test_private_practice_snapshot_progress_and_rejected_exclusion(community, mode):
    owner, creator, moderator, course, _, _ = community
    row = contribute(creator, course)
    path = f"/questions/{row['id']}"
    for state in ("DRAFT", "PENDING_REVIEW"):
        if state == "PENDING_REVIEW":
            assert creator.post(path + "/submit").status_code == 200
        hidden = owner.post(
            f"/courses/{course}/attempts", json={"count": 1, "selection_mode": mode}
        )
        assert hidden.status_code == 409
        attempt = start(creator, course, 1, selection_mode=mode)
        assert_no_keys(attempt)
        attempt_path = save_all(creator, course, attempt)
        assert (
            creator.patch(
                f"{attempt_path}/answers/{attempt['questions'][0]['id']}",
                json={"type": "TRUE_FALSE", "value": True},
            ).status_code
            == 200
        )
        if state == "PENDING_REVIEW":
            assert moderator.post(path + "/reject", json={"reason": "Improve"}).status_code == 200
        result = creator.post(attempt_path + "/submit").json()
        assert result["questions"][0]["grading_status"] == "CORRECT"
        assert creator.post(attempt_path + "/submit").json() == result
    progress = creator.get(f"/courses/{course}/review-progress").json()
    assert progress[0]["resolved_review_count"] == 2 and progress[0]["review_stage"] == 2
    assert owner.get(f"/courses/{course}/review-progress").json() == []
    assert (
        creator.post(
            f"/courses/{course}/attempts", json={"count": 1, "selection_mode": mode}
        ).status_code
        == 409
    )
    assert creator.patch(path, json={"stem": "Reworked"}).status_code == 200
    assert creator.post(path + "/submit").status_code == 200
    assert moderator.post(path + "/approve").status_code == 200
    assert start(owner, course, 1, selection_mode=mode)["questions"][0]["stem"] == "Reworked"


def test_cross_creator_duplicates_and_atomic_conflicting_approval(community):
    owner, creator, moderator, course, _, _ = community
    first = contribute(creator, course, "Same stem")
    second = contribute(owner, course, " SAME   STEM ")
    duplicate = document()
    duplicate["questions"] = [{"type": "TRUE_FALSE", "stem": "same stem", "correct_answer": True}]
    response = creator.post(f"/courses/{course}/questions/import", json=duplicate)
    assert response.status_code == 409 and "Same stem" not in response.text
    for client, row in ((creator, first), (owner, second)):
        assert client.post(f"/questions/{row['id']}/submit").status_code == 200

    def approve(row):
        with TestClient(app) as client:
            client.cookies.update(moderator.cookies)
            return client.post(f"/questions/{row['id']}/approve")

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(approve, [first, second]))
    assert sorted(r.status_code for r in results) == [200, 409]
    failed = first if results[0].status_code == 409 else second
    assert moderator.get(f"/questions/{failed['id']}").json()["status"] == "PENDING_REVIEW"
    assert len(moderator.get(f"/questions/{failed['id']}/versions").json()) == 2
    assert "Same stem" not in next(r.text for r in results if r.status_code == 409)


def test_governance_status_self_review_and_queue_filter(community):
    owner, creator, moderator, course, faculty, other = community
    assert creator.get(f"/faculties/{faculty}/moderator-status").json() == {"is_moderator": False}
    assert moderator.get(f"/faculties/{faculty}/moderator-status").json() == {"is_moderator": True}
    assert moderator.get(f"/faculties/{other}/moderator-status").json() == {"is_moderator": False}
    body = {"name": "New course", "faculty_id": faculty}
    assert creator.post("/courses", json=body).status_code == 403
    assert owner.post("/courses", json=body).status_code == 403
    assert moderator.post("/courses", json=body | {"faculty_id": other}).status_code == 403
    new = moderator.post("/courses", json=body)
    assert new.status_code == 201
    row = contribute(moderator, new.json()["id"])
    path = f"/questions/{row['id']}"
    assert moderator.post(path + "/submit").status_code == 200
    assert moderator.post(path + "/approve").status_code == 403
    assert moderator.post(path + "/reject", json={"reason": "Self"}).status_code == 403
    queue = f"/faculties/{faculty}/question-review"
    assert moderator.get(queue + f"?course_id={new.json()['id']}").json()[0]["id"] == row["id"]
    assert moderator.get(queue + f"?course_id={uuid4()}").status_code == 404
    provision(owner, other)
    foreign = owner.post("/courses", json=body | {"faculty_id": other}).json()["id"]
    assert moderator.get(queue + f"?course_id={foreign}").status_code == 404
    private = contribute(owner, foreign)
    assert moderator.get(f"/questions/{private['id']}").status_code == 404
    with TestClient(app) as anonymous:
        assert anonymous.get(queue).status_code == 401
        assert anonymous.get(f"/faculties/{faculty}/moderator-status").status_code == 401
    assert (
        creator.post(
            f"/faculties/{faculty}/moderator-status", json={"is_moderator": True}
        ).status_code
        == 405
    )


def history():
    with engine.connect() as conn:
        return [
            conn.execute(text(f"SELECT * FROM {table} ORDER BY id")).all()
            for table in ("questions", "question_versions", "question_options")
        ]


def test_migration_roundtrip_and_conflicting_downgrade_is_non_destructive(community):
    owner, creator, moderator, course, _, _ = community
    row = contribute(creator, course)
    creator.post(f"/questions/{row['id']}/submit")
    assert moderator.post(f"/questions/{row['id']}/approve").status_code == 200
    before = history()
    config = Config("alembic.ini")
    try:
        for _ in range(2):
            command.downgrade(config, "0010")
            assert history() == before
            command.upgrade(config, "0011")
            assert history() == before
        contribute(owner, course)  # Different creator, same stem, unapproved.
        conflicting = history()
        with pytest.raises(IntegrityError):
            command.downgrade(config, "0010")
        assert history() == conflicting
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0011"
    finally:
        command.upgrade(config, "head")
    with engine.connect() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "include_object": lambda obj, name, type_, reflected, compare_to: (
                    type_ != "table" or name in {"faculty_moderators", "questions"}
                )
            },
        )
        assert compare_metadata(context, Base.metadata) == []
