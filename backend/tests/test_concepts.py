import os
from uuid import UUID, uuid4

import pytest
from fake_ai import FakeProvider
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from app.database import SessionLocal, engine
from app.main import app
from app.models import CourseMembership
from app.models.ai_job import AIJob, AIUsage
from app.models.concept import Concept
from app.models.material import Material
from app.models.material_chunk import MaterialChunk
from app.services.ai.router import get_ai_provider

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setenv("AI_CONCEPT_CHUNKS_PER_REQUEST", "1")
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE users, courses, course_memberships CASCADE"))
    provider = FakeProvider()
    app.dependency_overrides[get_ai_provider] = lambda: provider
    with TestClient(app) as owner, TestClient(app) as member, TestClient(app) as outsider:
        for client, name in ((owner, "owner"), (member, "member"), (outsider, "outsider")):
            assert (
                client.post(
                    "/auth/register",
                    json={
                        "email": f"{name}@example.com",
                        "password": "correct horse",
                        "display_name": name,
                    },
                ).status_code
                == 201
            )
        course = owner.post("/courses", json={"name": "Concepts"}).json()["id"]
        member_id = member.get("/auth/me").json()["id"]
        with SessionLocal() as db:
            db.add(CourseMembership(course_id=UUID(course), user_id=UUID(member_id), role="MEMBER"))
            material = Material(
                course_id=UUID(course),
                uploaded_by_user_id=UUID(member_id),
                original_filename="unused.pdf",
                media_type="application/pdf",
                file_size_bytes=20,
                storage_key=f"{uuid4().hex}.pdf",
                status="READY",
            )
            db.add(material)
            db.flush()
            material_id = str(material.id)
            for n in range(2):
                content = f"Linear algebra source {n}"
                db.add(
                    MaterialChunk(
                        material_id=material.id, ordinal=n, content=content, char_count=len(content)
                    )
                )
            db.commit()
        try:
            yield owner, member, outsider, course, material_id, provider
        finally:
            app.dependency_overrides.pop(get_ai_provider, None)


def test_member_extract_review_provenance_and_rerun(setup):
    owner, member, outsider, course, material, provider = setup
    path = f"/materials/{material}/concept-extraction"
    with TestClient(app) as anonymous:
        assert anonymous.post(path).status_code == 401
    assert outsider.post(path).status_code == 404
    assert outsider.get(f"/courses/{course}/concepts").status_code == 404
    response = member.post(path)
    assert response.status_code == 200, response.text
    job = response.json()
    assert job["status"] == "SUCCEEDED"
    assert job["prompt_version"] == "concepts-v1"
    assert job["input_chunk_count"] == 2
    assert len(job["input_chunk_ids"]) == 2
    assert len(job["usage"]) == 2
    assert all(float(u["estimated_cost"]) == 0 and u["total_tokens"] == 30 for u in job["usage"])
    assert member.get(f"/ai/jobs/{job['id']}").status_code == 200
    assert outsider.get(f"/ai/jobs/{job['id']}").status_code == 404
    concepts = member.get(f"/courses/{course}/concepts?material_id={material}").json()
    assert len(concepts) == 1
    concept = concepts[0]
    assert concept["status"] == "DRAFT"
    concept_path = f"/concepts/{concept['id']}"
    detail = member.get(concept_path).json()
    assert [c["ordinal"] for c in detail["source_chunks"]] == [0, 1]
    assert outsider.get(concept_path).status_code == 404
    assert member.patch(f"{concept_path}/status", json={"status": "APPROVED"}).status_code == 403
    provider.description = "Updated draft"
    assert member.post(path).json()["status"] == "SUCCEEDED"
    assert len(member.get(f"/courses/{course}/concepts").json()) == 1
    assert member.get(concept_path).json()["description"] == "Updated draft"
    assert owner.patch(f"{concept_path}/status", json={"status": "APPROVED"}).status_code == 200
    approved = member.get(concept_path).json()
    provider.description = "Should not overwrite"
    assert member.post(path).json()["status"] == "SUCCEEDED"
    assert member.get(concept_path).json() == approved
    assert owner.patch(f"{concept_path}/status", json={"status": "REJECTED"}).status_code == 409
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(AIUsage)) == 6
        assert db.scalar(select(func.count()).select_from(AIJob)) == 3


@pytest.mark.parametrize(
    "failure,code",
    [
        ("failure", "PROVIDER_FAILURE"),
        ("invalid", "INVALID_OUTPUT"),
        ("bad_source", "INVALID_PROVENANCE"),
    ],
)
def test_failures_are_atomic_and_audited(setup, failure, code):
    _, member, _, course, material, provider = setup
    setattr(provider, failure, True)
    response = member.post(f"/materials/{material}/concept-extraction")
    job = response.json()
    assert job["status"] == "FAILED", response.text
    assert job["error_code"] == code
    assert "session-secret" not in response.text
    assert job["usage"]
    assert member.get(f"/courses/{course}/concepts").json() == []


def test_non_ready_rejected_without_provider(setup):
    _, member, _, _, material, provider = setup
    with SessionLocal() as db:
        db.get(Material, UUID(material)).status = "FAILED"
        db.commit()
    assert member.post(f"/materials/{material}/concept-extraction").status_code == 409
    assert provider.calls == []


def test_reject_and_preserve_rejected(setup):
    owner, member, _, course, material, _ = setup
    path = f"/materials/{material}/concept-extraction"
    member.post(path)
    concept = member.get(f"/courses/{course}/concepts").json()[0]
    status_path = f"/concepts/{concept['id']}/status"
    assert owner.patch(status_path, json={"status": "REJECTED"}).status_code == 200
    assert member.post(path).json()["status"] == "SUCCEEDED"
    assert member.get(f"/courses/{course}/concepts").json()[0]["status"] == "REJECTED"


def test_active_job_conflict_prevents_duplicate_inference(setup):
    _, member, _, course, material, provider = setup
    with SessionLocal() as db:
        db.add(
            AIJob(
                course_id=UUID(course),
                material_id=UUID(material),
                requested_by_user_id=UUID(member.get("/auth/me").json()["id"]),
                provider="fake",
                model="test",
                prompt_version="concepts-v1",
                status="RUNNING",
                input_chunk_count=0,
                input_char_count=0,
                input_chunk_ids=[],
                batch_count=0,
            )
        )
        db.commit()
    assert member.post(f"/materials/{material}/concept-extraction").status_code == 409
    assert provider.calls == []


def test_persistence_failure_rolls_back_all_concepts(setup, monkeypatch):
    _, member, _, course, material, _ = setup
    from sqlalchemy.orm import Session

    from app.models.concept import ConceptChunk

    original = Session.add

    def add(self, row, *args, **kwargs):
        if isinstance(row, ConceptChunk):
            raise RuntimeError("private database error")
        return original(self, row, *args, **kwargs)

    monkeypatch.setattr(Session, "add", add)
    result = member.post(f"/materials/{material}/concept-extraction").json()
    assert result["status"] == "FAILED"
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Concept)) == 0
