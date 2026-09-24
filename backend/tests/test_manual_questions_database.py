import os
from uuid import UUID, uuid4

import pytest
from community_helpers import provision
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from test_materials import clients as clients

from app.database import SessionLocal
from app.main import app
from app.models.concept import Concept
from app.models.question import (
    Question,
    QuestionChunk,
    QuestionConcept,
    QuestionOption,
    QuestionVersion,
)
from app.services.questions import service

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def body(type_: str = "MULTIPLE_CHOICE") -> dict[str, object]:
    common: dict[str, object] = {"type": type_, "stem": f"Manual {type_}?"}
    if type_ == "MULTIPLE_CHOICE":
        return common | {
            "options": [
                {"text": "First", "is_correct": True},
                {"text": "Second", "is_correct": False},
            ]
        }
    if type_ == "TRUE_FALSE":
        return common | {"correct_answer": False}
    return common | {"reference_answer": "A reference answer"}


def counts() -> tuple[int, ...]:
    with SessionLocal() as db:
        return tuple(
            db.scalar(select(func.count()).select_from(model)) or 0
            for model in (Question, QuestionOption, QuestionConcept, QuestionChunk, QuestionVersion)
        )


def add_concept(course_id: str, status: str = "APPROVED") -> str:
    with SessionLocal() as db:
        concept = Concept(
            course_id=UUID(course_id),
            name=f"Concept {uuid4().hex}",
            normalized_name=uuid4().hex,
            status=status,
            created_by="USER",
            importance="HIGH",
        )
        db.add(concept)
        db.commit()
        return str(concept.id)


def test_manual_create_membership_privacy_and_submission(clients, monkeypatch):
    owner, member, outsider, course = clients
    monkeypatch.setenv("AI_PROVIDER", "disabled")
    monkeypatch.setenv("EMBEDDING_PROVIDER", "disabled")
    path = f"/courses/{course}/questions"
    with TestClient(app) as anonymous:
        assert anonymous.post(path, json=body()).status_code == 401
    assert outsider.post(path, json=body()).status_code == 404
    assert owner.post(f"/courses/{uuid4()}/questions", json=body()).status_code == 404
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    provision(outsider, faculty)
    assert outsider.post(path, json=body()).status_code == 404

    created = member.post(path, json=body())
    assert created.status_code == 201, created.text
    row = created.json()
    assert row["visibility"] == "OWNER"
    assert row["course_id"] == course
    assert row["created_by_user_id"] == member.get("/auth/me").json()["id"]
    assert row["source"] == "USER" and row["status"] == "DRAFT"
    assert row["ai_job_id"] is None
    assert row["concept_ids"] == [] and row["source_chunks"] == []
    assert row["options"][0]["is_correct"] is True
    with TestClient(app) as peer:
        assert (
            peer.post(
                "/auth/register",
                json={
                    "email": "peer@example.com",
                    "password": "correct horse",
                    "display_name": "Peer",
                },
            ).status_code
            == 201
        )
        assert peer.post(f"/courses/{course}/join").status_code == 200
        assert peer.get(f"/questions/{row['id']}").status_code == 404
    assert peer.get(path).json() == []
    assert member.get(f"/questions/{row['id']}").json() == row
    edited = member.patch(f"/questions/{row['id']}", json={"stem": "A revised manual question?"})
    assert edited.status_code == 200, edited.text
    assert edited.json()["source"] == "USER" and edited.json()["concept_ids"] == []
    assert [v["reason"] for v in member.get(f"/questions/{row['id']}/versions").json()] == [
        "CREATED",
        "EDITED",
    ]
    assert member.post(f"/questions/{row['id']}/submit").json()["status"] == "PENDING_REVIEW"

    created_by_owner = owner.post(path, json=body("TRUE_FALSE"))
    assert created_by_owner.status_code == 201, created_by_owner.text
    assert created_by_owner.json()["created_by_user_id"] == owner.get("/auth/me").json()["id"]
    assert created_by_owner.json()["correct_boolean"] is False


@pytest.mark.parametrize("type_", ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"])
def test_manual_create_types_and_version(clients, type_):
    owner, _, _, course = clients
    response = owner.post(f"/courses/{course}/questions", json=body(type_))
    assert response.status_code == 201, response.text
    row = response.json()
    assert row["type"] == type_ and row["status"] == "DRAFT"
    assert row["source"] == "USER" and row["ai_job_id"] is None
    assert row["source_chunks"] == [] and row["concept_ids"] == []
    if type_ == "TRUE_FALSE":
        assert row["correct_boolean"] is False and row["options"] == []
    elif type_ == "SHORT_ANSWER":
        assert row["reference_answer"] == "A reference answer" and row["options"] == []
    else:
        assert [option["is_correct"] for option in row["options"]] == [True, False]
    versions = owner.get(f"/questions/{row['id']}/versions").json()
    assert len(versions) == 1
    assert versions[0]["version_number"] == 1 and versions[0]["reason"] == "CREATED"
    assert versions[0]["changed_by_user_id"] == row["created_by_user_id"]
    assert versions[0]["snapshot"] == row


def test_manual_create_optional_approved_concepts(clients):
    owner, member, _, course = clients
    approved = [add_concept(course) for _ in range(5)]
    draft = add_concept(course, "DRAFT")
    rejected = add_concept(course, "REJECTED")
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    foreign_course = owner.post("/courses", json={"name": "Another", "faculty_id": faculty}).json()[
        "id"
    ]
    foreign = add_concept(foreign_course)
    path = f"/courses/{course}/questions"
    for ids in ([approved[0]] * 2, [draft], [rejected], [foreign], [str(uuid4())]):
        assert member.post(path, json=body() | {"concept_ids": ids}).status_code == 422
        assert counts() == (0, 0, 0, 0, 0)
    assert member.post(path, json=body() | {"concept_ids": ["invalid-uuid"]}).status_code == 422
    too_many = member.post(path, json=body() | {"concept_ids": approved + [str(uuid4())]})
    assert too_many.status_code == 422
    assert counts() == (0, 0, 0, 0, 0)
    created = member.post(path, json=body() | {"concept_ids": approved})
    assert created.status_code == 201, created.text
    assert set(created.json()["concept_ids"]) == set(approved)
    assert created.json()["source_chunks"] == []


@pytest.mark.parametrize(
    "change",
    [
        {"stem": " "},
        {"stem": "x" * 401},
        {"difficulty": 0},
        {"difficulty": 6},
        {"difficulty": True},
        {"options": [{"text": "Only", "is_correct": True}]},
        {"options": [{"text": str(i), "is_correct": i == 0} for i in range(7)]},
        {"options": [{"text": "A", "is_correct": False}, {"text": "B", "is_correct": False}]},
        {"options": [{"text": "A", "is_correct": True}, {"text": "B", "is_correct": True}]},
        {"options": [{"text": " A ", "is_correct": True}, {"text": "a", "is_correct": False}]},
        {"options": [{"text": "x" * 401, "is_correct": True}, {"text": "B", "is_correct": False}]},
        {"course_id": str(uuid4())},
        {"created_by_user_id": str(uuid4())},
        {"status": "APPROVED"},
        {"source": "AI"},
        {"ai_job_id": str(uuid4())},
        {"reviewed_by_user_id": str(uuid4())},
        {"source_chunks": []},
        {"version_number": 2},
        {"unexpected": "field"},
    ],
)
def test_manual_create_rejects_invalid_mcq_and_server_fields(clients, change):
    owner, _, _, course = clients
    assert owner.post(f"/courses/{course}/questions", json=body() | change).status_code == 422
    assert counts() == (0, 0, 0, 0, 0)


@pytest.mark.parametrize(
    "type_,change",
    [
        ("TRUE_FALSE", {"correct_answer": "true"}),
        ("TRUE_FALSE", {"correct_answer": 1}),
        ("TRUE_FALSE", {"options": []}),
        ("SHORT_ANSWER", {"reference_answer": " "}),
        ("SHORT_ANSWER", {"reference_answer": "x" * 2001}),
        ("SHORT_ANSWER", {"correct_answer": True}),
    ],
)
def test_manual_create_rejects_invalid_other_types(clients, type_, change):
    owner, _, _, course = clients
    assert owner.post(f"/courses/{course}/questions", json=body(type_) | change).status_code == 422
    assert counts() == (0, 0, 0, 0, 0)


def test_manual_create_duplicate_and_persistence_rollback(clients, monkeypatch):
    owner, member, _, course = clients
    path = f"/courses/{course}/questions"
    created = member.post(path, json=body())
    assert created.status_code == 201
    before = counts()
    duplicate = member.post(path, json=body() | {"stem": "  MANUAL   multiple_choice?  "})
    assert duplicate.status_code == 409
    assert "private" not in duplicate.text
    assert counts() == before
    assert owner.post(path, json=body()).status_code == 201  # Other private creator.

    original = service.add_version

    def fail_version(db, question, user, reason):
        original(db, question, user, reason)
        raise RuntimeError("private injected persistence failure")

    monkeypatch.setattr(service, "add_version", fail_version)
    before = counts()
    failed = member.post(path, json=body("SHORT_ANSWER"))
    assert failed.status_code == 503
    assert "private" not in failed.text and "injected" not in failed.text
    assert counts() == before
