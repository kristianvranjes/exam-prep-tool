import json
import os
from uuid import UUID, uuid4

import httpx
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
        course = owner.post(
            "/courses",
            json={"name": "Concepts", "faculty_id": owner.get("/faculties").json()[0]["id"]},
        ).json()["id"]
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


@pytest.mark.parametrize("mode", ["usage", "no_usage", "failure", "invalid_schema", "key_echo"])
def test_freellmapi_member_extraction_and_audit(setup, monkeypatch, mode):
    _, member, _, course, material, _ = setup
    monkeypatch.setenv("AI_PROVIDER", "freellmapi")
    monkeypatch.setenv("FREELLMAPI_URL", "http://localhost:3001/v1")
    monkeypatch.setenv("FREELLMAPI_MODEL", "auto")
    monkeypatch.setenv("FREELLMAPI_API_KEY", "private-gateway-key")
    app.dependency_overrides.pop(get_ai_provider)
    original = httpx.Client

    def handler(request):
        if mode == "failure":
            return httpx.Response(500, text="private-gateway-key http://private.internal traceback")
        body = json.loads(request.content)
        chunks = json.loads(body["messages"][1]["content"])["chunks"]
        content = json.dumps(
            {
                "concepts": [
                    {
                        "name": "Algebra",
                        "description": "Supported",
                        "aliases": [],
                        "importance": "HIGH",
                        "source_chunk_ordinals": [chunks[0]["ordinal"]],
                    }
                ]
            }
        )
        if mode == "invalid_schema":
            content = '{"concepts":[{"name":42}]}'
        if mode == "key_echo":
            content = content.replace("Supported", "private-gateway-key")
        response = {"choices": [{"message": {"content": content}}]}
        if mode != "no_usage":
            response["usage"] = {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 18}
        return httpx.Response(200, json=response, headers={"X-Routed-Via": "platform/model"})

    monkeypatch.setattr(
        httpx, "Client", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs)
    )
    response = member.post(f"/materials/{material}/concept-extraction")
    assert response.status_code == 200
    assert "private-gateway-key" not in response.text
    assert "private.internal" not in response.text
    job = response.json()
    assert (job["provider"], job["model"]) == ("freellmapi", "auto")
    if mode in ("failure", "invalid_schema", "key_echo"):
        assert job["status"] == "FAILED"
        assert job["error_code"] == ("UNAVAILABLE" if mode == "failure" else "INVALID_OUTPUT")
        assert job["usage"][0]["total_tokens"] == (None if mode == "failure" else 18)
        assert member.get(f"/courses/{course}/concepts").json() == []
    else:
        assert job["status"] == "SUCCEEDED"
        assert len(job["usage"]) == 2
        for usage in job["usage"]:
            assert (usage["provider"], usage["model"]) == ("platform", "model")
            assert usage["total_tokens"] == (18 if mode == "usage" else None)
            assert usage["prompt_tokens"] == (10 if mode == "usage" else None)
            assert usage["completion_tokens"] == (5 if mode == "usage" else None)
        concepts = member.get(f"/courses/{course}/concepts").json()
        assert len(concepts) == 1
        assert concepts[0]["status"] == "DRAFT"


@pytest.mark.parametrize("status", ["APPROVED", "REJECTED"])
def test_review_during_inference_and_concurrent_extraction(setup, monkeypatch, status):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    owner, member, _, course, material, provider = setup
    path = f"/materials/{material}/concept-extraction"
    assert member.post(path).json()["status"] == "SUCCEEDED"
    concept = member.get(f"/courses/{course}/concepts").json()[0]
    entered, release = Event(), Event()
    original = provider.generate_structured

    def paused(*args):
        entered.set()
        assert release.wait(15), "Test did not release inference"
        return original(*args)

    monkeypatch.setattr(provider, "generate_structured", paused)
    provider.description = "Must not overwrite reviewed data"
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(member.post, path)
        try:
            assert entered.wait(10)
            # The active index rejects another request without invoking the paused provider.
            assert owner.post(path).status_code == 409
            review_path = f"/concepts/{concept['id']}/status"
            assert owner.patch(review_path, json={"status": status}).status_code == 200
            protected = owner.get(f"/concepts/{concept['id']}").json()
        finally:
            release.set()
        assert future.result(timeout=15).json()["status"] == "SUCCEEDED"
    assert owner.get(f"/concepts/{concept['id']}").json() == protected


def test_user_draft_is_never_overwritten(setup):
    _, member, outsider, course, material, provider = setup
    path = f"/materials/{material}/concept-extraction"
    member.post(path)
    concept = member.get(f"/courses/{course}/concepts").json()[0]
    with SessionLocal() as db:
        row = db.get(Concept, UUID(concept["id"]))
        row.created_by = "USER"
        db.commit()
    protected = member.get(f"/concepts/{concept['id']}").json()
    provider.description = "Replacement"
    assert member.post(path).json()["status"] == "SUCCEEDED"
    assert member.get(f"/concepts/{concept['id']}").json() == protected
    assert (
        outsider.patch(f"/concepts/{concept['id']}/status", json={"status": "APPROVED"}).status_code
        == 404
    )


def test_review_refreshes_after_waiting_for_course_lock(setup):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from sqlalchemy import event

    from app.models import Course

    owner, member, _, course, material, _ = setup
    member.post(f"/materials/{material}/concept-extraction")
    concept = member.get(f"/courses/{course}/concepts").json()[0]
    waiting = Event()

    def before_execute(conn, cursor, statement, parameters, context, executemany):
        if "FOR UPDATE" in statement:
            waiting.set()

    with ThreadPoolExecutor(max_workers=1) as pool, SessionLocal() as db:
        db.scalar(select(Course).where(Course.id == UUID(course)).with_for_update())
        event.listen(engine, "before_cursor_execute", before_execute)
        future = pool.submit(
            owner.patch, f"/concepts/{concept['id']}/status", json={"status": "REJECTED"}
        )
        try:
            assert waiting.wait(10), "Review did not reach the course lock"
            row = db.get(Concept, UUID(concept["id"]))
            row.status = "APPROVED"
            db.commit()
            assert future.result(timeout=15).status_code == 409
        finally:
            db.rollback()
            event.remove(engine, "before_cursor_execute", before_execute)
    assert owner.get(f"/concepts/{concept['id']}").json()["status"] == "APPROVED"


def test_citation_to_another_batch_is_rejected(setup, monkeypatch):
    from dataclasses import replace

    _, member, _, course, material, provider = setup
    original = provider.generate_structured

    def wrong_batch(*args):
        generation = original(*args)
        content = json.loads(generation.content)
        # Ordinal 1 exists in this material but was not sent in the first batch.
        content["concepts"][0]["source_chunk_ordinals"] = [1]
        return replace(generation, content=json.dumps(content))

    monkeypatch.setattr(provider, "generate_structured", wrong_batch)
    job = member.post(f"/materials/{material}/concept-extraction").json()
    assert job["error_code"] == "INVALID_PROVENANCE"
    assert job["usage"][0]["total_tokens"] == 30
    assert member.get(f"/courses/{course}/concepts").json() == []


def test_failed_rerun_rolls_back_existing_draft_changes(setup, monkeypatch):
    from sqlalchemy.orm import Session

    _, member, _, course, material, provider = setup
    path = f"/materials/{material}/concept-extraction"
    member.post(path)
    before = member.get(f"/courses/{course}/concepts").json()
    provider.description = "Must roll back"
    original = Session.flush

    def fail_after_flush(self, *args, **kwargs):
        changed_concept = any(isinstance(row, Concept) for row in self.dirty)
        original(self, *args, **kwargs)
        if changed_concept:
            raise RuntimeError("private persistence failure")

    monkeypatch.setattr(Session, "flush", fail_after_flush)
    job = member.post(path).json()
    assert job["status"] == "FAILED"
    assert len(job["usage"]) == 2
    assert member.get(f"/courses/{course}/concepts").json() == before


def test_phase4_models_match_migrated_schema():
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    from app.database import Base

    tables = {"concepts", "concept_chunks", "ai_jobs", "ai_usage"}
    with engine.connect() as connection:
        context = MigrationContext.configure(
            connection,
            opts={
                "include_object": lambda obj, name, type_, reflected, compare_to: (
                    type_ != "table" or name in tables
                )
            },
        )
        assert compare_metadata(context, Base.metadata) == []
