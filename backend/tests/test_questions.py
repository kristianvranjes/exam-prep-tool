import json
import os
from uuid import UUID, uuid4

import pytest
import test_retrieval
from fake_questions import FakeQuestions
from fastapi.testclient import TestClient
from sqlalchemy import func, select

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
from app.services.ai.router import get_ai_provider

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")
retrieval_data = test_retrieval.data


@pytest.fixture
def questions(retrieval_data):
    d = retrieval_data
    with SessionLocal() as db:
        concept = Concept(
            course_id=UUID(d.course),
            name="Alpha",
            normalized_name="alpha",
            description="Supported concept",
            status="APPROVED",
            created_by="USER",
            importance="HIGH",
        )
        db.add(concept)
        db.commit()
        d.concept = str(concept.id)
    assert d.member.post(d.embed).status_code == 200
    d.generator = FakeQuestions()
    app.dependency_overrides[get_ai_provider] = lambda: d.generator
    d.generate = f"/courses/{d.course}/questions/generate"
    d.bank = f"/courses/{d.course}/questions"
    d.body = {
        "concept_ids": [d.concept],
        "question_types": ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"],
        "count": 3,
        "retrieval_top_k": 2,
    }
    try:
        yield d
    finally:
        app.dependency_overrides.pop(get_ai_provider, None)


def generated(d):
    response = d.owner.post(d.generate, json=d.body)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "SUCCEEDED", response.text
    return d.owner.get(d.bank).json()


def test_generation_audit_provenance_and_secure_reads(questions):
    d = questions
    rows = generated(d)
    assert len(rows) == 3
    assert {r["type"] for r in rows} == set(d.body["question_types"])
    for row in rows:
        assert row["status"] == "DRAFT" and row["source"] == "AI"
        assert row["concept_ids"] == [d.concept]
        assert row["source_chunks"]
        assert d.member.get(f"/questions/{row['id']}").status_code == 404
        assert d.outsider.get(f"/questions/{row['id']}").status_code == 404
        versions = d.owner.get(f"/questions/{row['id']}/versions").json()
        assert len(versions) == 1 and versions[0]["reason"] == "CREATED"
        assert versions[0]["snapshot"] == row
    job = d.owner.get(f"/ai/jobs/{rows[0]['ai_job_id']}").json()
    assert job["operation"] == "QUESTION_GENERATION"
    assert job["input_concept_ids"] == [d.concept]
    assert job["prompt_version"] == "questions-v1"
    assert job["usage"][0]["total_tokens"] == 50
    assert d.member.get(f"/ai/jobs/{job['id']}").status_code == 403
    assert d.member.get(d.bank + "?status=DRAFT").json() == []
    assert len(d.generator.calls) == 1
    system, prompt = d.generator.calls[0]
    payload = json.loads(prompt)
    assert len(payload["sources"]) == len({s["ref"] for s in payload["sources"]})
    assert d.concept not in prompt and d.material not in prompt
    assert "untrusted" in system


@pytest.mark.parametrize(
    "mode,code",
    [
        ("failure", "PROVIDER_FAILURE"),
        ("invalid", "INVALID_OUTPUT"),
        ("json", "INVALID_OUTPUT"),
        ("type", "INVALID_OUTPUT"),
        ("concept", "INVALID_PROVENANCE"),
        ("source", "INVALID_PROVENANCE"),
        ("duplicate", "DUPLICATE_QUESTION"),
        ("count", "INVALID_COUNT"),
    ],
)
def test_atomic_generation_failures(questions, mode, code):
    d = questions
    d.generator.mode = mode
    response = d.owner.post(d.generate, json=d.body)
    job = response.json()
    assert job["status"] == "FAILED", response.text
    assert job["error_code"] == code
    assert job["usage"][0]["total_tokens"] == (None if mode == "failure" else 50)
    assert "secret" not in response.text and "raw" not in response.text
    with SessionLocal() as db:
        for model in [Question, QuestionOption, QuestionConcept, QuestionChunk, QuestionVersion]:
            assert db.scalar(select(func.count()).select_from(model)) == 0


def test_generation_permissions_concepts_and_no_sources(questions):
    d = questions
    assert d.member.post(d.generate, json=d.body).status_code == 403
    assert d.outsider.post(d.generate, json=d.body).status_code == 404
    with TestClient(app) as anon:
        assert anon.post(d.generate, json=d.body).status_code == 401
    assert (
        d.owner.post(d.generate, json=d.body | {"concept_ids": [str(uuid4())]}).status_code == 422
    )
    with SessionLocal() as db:
        concept = db.get(Concept, UUID(d.concept))
        concept.status = "DRAFT"
        db.commit()
    assert d.owner.post(d.generate, json=d.body).status_code == 422
    with SessionLocal() as db:
        db.get(Concept, UUID(d.concept)).status = "APPROVED"
        db.commit()
    d.provider.signature = "b" * 64
    assert d.owner.post(d.generate, json=d.body).status_code == 409
    assert d.generator.calls == []


def test_bounds_and_duplicates(questions, monkeypatch):
    d = questions
    monkeypatch.setenv("QUESTION_GENERATION_MAX_CONTEXT_CHARS", "1000")
    monkeypatch.setenv("QUESTION_GENERATION_MAX_CONTEXT_CHUNKS", "1")
    assert d.owner.post(d.generate, json=d.body).status_code == 422
    assert d.generator.calls == []
    monkeypatch.setenv("QUESTION_GENERATION_MAX_CONTEXT_CHUNKS", "12")
    rows = generated(d)
    job = d.owner.post(d.generate, json=d.body).json()
    assert job["error_code"] == "DUPLICATE_QUESTION"
    assert d.owner.get(d.bank).json() == rows


def test_full_lifecycle_versions_and_member_redaction(questions):
    d = questions
    rows = generated(d)
    for row in rows:
        path = f"/questions/{row['id']}"
        assert d.owner.post(path + "/approve").status_code == 409
        assert d.owner.post(path + "/reject", json={"reason": "not yet"}).status_code == 409
        assert d.owner.post(path + "/submit").json()["status"] == "PENDING_REVIEW"
        assert d.member.get(path).status_code == 404
        assert d.owner.patch(path, json={"stem": "no"}).status_code == 409
        assert d.owner.post(path + "/reject", json={"reason": " "}).status_code == 422
        rejected = d.owner.post(path + "/reject", json={"reason": "Needs precision"}).json()
        assert rejected["reviewed_at"] and rejected["rejection_reason"]
        assert d.member.get(path).status_code == 404
        assert d.owner.post(path + "/approve").status_code == 409
        edited = d.owner.patch(path, json={"stem": row["stem"] + " Revised"}).json()
        assert edited["status"] == "DRAFT" and edited["reviewed_at"] is None
        assert edited["rejection_reason"] is None and edited["reviewed_by_user_id"] is None
        assert edited["source_chunks"] == row["source_chunks"]
        d.owner.post(path + "/submit")
        approved = d.owner.post(path + "/approve").json()
        assert approved["status"] == "APPROVED" and approved["reviewed_at"]
        public = d.member.get(path)
        assert public.status_code == 200
        for key in [
            "is_correct",
            "correct_boolean",
            "reference_answer",
            "explanation",
            "ai_job_id",
            "reviewed_at",
            "rejection_reason",
        ]:
            assert key not in public.text
        assert d.member.get(path + "/versions").status_code == 403
        assert d.member.patch(path, json={"stem": "no"}).status_code == 403
        for action in ["submit", "approve", "archive"]:
            assert d.member.post(path + "/" + action).status_code == 403
        assert d.member.post(path + "/reject", json={"reason": "no"}).status_code == 403
        assert d.owner.patch(path, json={"stem": "no"}).status_code == 409
        assert d.owner.post(path + "/archive").json()["status"] == "ARCHIVED"
        assert d.member.get(path).status_code == 404
        for action in ["submit", "approve", "archive"]:
            assert d.owner.post(path + "/" + action).status_code == 409
        assert d.owner.patch(path, json={"stem": "no"}).status_code == 409
        versions = d.owner.get(path + "/versions").json()
        assert [v["version_number"] for v in versions] == list(range(1, 8))
        assert [v["reason"] for v in versions] == [
            "CREATED",
            "SUBMITTED",
            "REJECTED",
            "EDITED",
            "SUBMITTED",
            "APPROVED",
            "ARCHIVED",
        ]
        assert versions[0]["snapshot"] == row
    assert d.member.get(d.bank).json() == []
    assert len(d.owner.get(d.bank + "?status=ARCHIVED&limit=2").json()) == 2


def test_persistence_and_transition_rollback(questions, monkeypatch):
    from app.services.questions import generation, service

    d = questions
    original = generation.add_version
    calls = []

    def fail(db, question, user, reason):
        calls.append(question.id)
        original(db, question, user, reason)
        if len(calls) == 2:
            raise RuntimeError("private database failure")

    monkeypatch.setattr(generation, "add_version", fail)
    assert d.owner.post(d.generate, json=d.body).json()["status"] == "FAILED"
    assert d.owner.get(d.bank).json() == []
    monkeypatch.setattr(generation, "add_version", original)
    row = generated(d)[0]

    def fail_version(*args):
        raise RuntimeError("secret")

    monkeypatch.setattr(service, "add_version", fail_version)
    assert d.owner.post(f"/questions/{row['id']}/submit").status_code == 503
    assert d.owner.get(f"/questions/{row['id']}").json() == row
    assert len(d.owner.get(f"/questions/{row['id']}/versions").json()) == 1


@pytest.mark.parametrize("status", ["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "ARCHIVED"])
def test_complete_transition_matrix(questions, status):
    d = questions
    row = generated(d)[0]
    path = f"/questions/{row['id']}"
    allowed = {
        ("DRAFT", "submit"),
        ("PENDING_REVIEW", "approve"),
        ("PENDING_REVIEW", "reject"),
        ("APPROVED", "archive"),
    }
    for action in ["submit", "approve", "reject", "archive", "edit"]:
        with SessionLocal() as db:
            db.get(Question, UUID(row["id"])).status = status
            db.commit()
        if action == "edit":
            result = d.owner.patch(path, json={"stem": row["stem"]})
            valid = status in ("DRAFT", "REJECTED")
        else:
            result = d.owner.post(path + "/" + action, json={"reason": "Needs rework"})
            valid = (status, action) in allowed
        assert result.status_code == (200 if valid else 409), result.text


def test_concurrent_review_reloads_stale_question(questions):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from sqlalchemy import event

    from app.database import engine
    from app.models import User
    from app.services.questions.service import transition

    d = questions
    row = generated(d)[0]
    path = f"/questions/{row['id']}"
    d.owner.post(path + "/submit")
    waiting = Event()

    def reached_lock(conn, cursor, statement, parameters, context, executemany):
        if "FOR UPDATE" in statement:
            waiting.set()

    with ThreadPoolExecutor(max_workers=1) as pool, SessionLocal() as db:
        db.scalar(select(Question).where(Question.id == UUID(row["id"])).with_for_update())
        user = db.get(User, UUID(row["created_by_user_id"]))
        event.listen(engine, "before_cursor_execute", reached_lock)
        future = pool.submit(d.owner.post, path + "/reject", json={"reason": "Concurrent"})
        try:
            assert waiting.wait(10)
            # The other transaction has already loaded PENDING_REVIEW and is blocked.
            assert transition(db, user, UUID(row["id"]), "approve").status == "APPROVED"
            assert future.result(timeout=15).status_code == 409
        finally:
            db.rollback()
            event.remove(engine, "before_cursor_execute", reached_lock)
    versions = d.owner.get(path + "/versions").json()
    assert [v["reason"] for v in versions] == ["CREATED", "SUBMITTED", "APPROVED"]
    assert d.owner.get(path).json()["status"] == "APPROVED"


def test_active_generation_conflict_and_changed_source(questions, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from app.models.material_chunk import MaterialChunk

    d = questions
    entered, release = Event(), Event()
    original = d.generator.generate_structured

    def paused(*args):
        entered.set()
        assert release.wait(15)
        return original(*args)

    monkeypatch.setattr(d.generator, "generate_structured", paused)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(d.owner.post, d.generate, json=d.body)
        try:
            assert entered.wait(10)
            assert d.owner.post(d.generate, json=d.body).status_code == 409
            assert d.member.post(f"/materials/{d.material}/concept-extraction").status_code == 409
            with SessionLocal() as db:
                for chunk in db.scalars(select(MaterialChunk)):
                    chunk.content = "changed"
                db.commit()
        finally:
            release.set()
        job = future.result(timeout=15).json()
    assert job["error_code"] == "STALE_SOURCES"
    assert len(d.generator.calls) == 1
    assert d.owner.get(d.bank).json() == []


def test_foreign_provenance_and_deterministic_dedup(questions, monkeypatch):
    from app.models.material_chunk import MaterialChunk
    from app.schemas.retrieval import SearchHit
    from app.services import retrieval

    d = questions
    foreign = d.outsider.post("/courses", json={"name": "Private"}).json()["id"]
    with SessionLocal() as db:
        concept = Concept(
            course_id=UUID(foreign),
            name="Private",
            normalized_name="private",
            status="APPROVED",
            created_by="USER",
            importance="HIGH",
        )
        db.add(concept)
        db.commit()
        foreign_concept = str(concept.id)
    assert (
        d.owner.post(d.generate, json=d.body | {"concept_ids": [foreign_concept]}).status_code
        == 422
    )
    foreign_material = test_retrieval.add_material(
        foreign, d.outsider.get("/auth/me").json()["id"], ["Private text"]
    )
    with SessionLocal() as db:
        chunk = db.scalar(
            select(MaterialChunk).where(MaterialChunk.material_id == UUID(foreign_material))
        )
        foreign_hit = SearchHit(
            chunk_id=chunk.id,
            material_id=chunk.material_id,
            ordinal=0,
            content=chunk.content,
            distance=0,
            similarity=1,
        )
    original = retrieval.search
    monkeypatch.setattr(retrieval, "search", lambda *args: [foreign_hit])
    assert d.owner.post(d.generate, json=d.body).status_code == 409
    assert d.generator.calls == []
    monkeypatch.setattr(retrieval, "search", original)
    with SessionLocal() as db:
        second = Concept(
            course_id=UUID(d.course),
            name="Alpha too",
            normalized_name="alpha too",
            status="APPROVED",
            created_by="USER",
            importance="HIGH",
        )
        db.add(second)
        db.commit()
        d.body["concept_ids"].append(str(second.id))
    generated(d)
    prompt = d.generator.calls[0][1]
    assert len(json.loads(prompt)["sources"]) == 2
    d.body["concept_ids"].reverse()
    assert d.owner.post(d.generate, json=d.body).json()["error_code"] == "DUPLICATE_QUESTION"
    assert d.generator.calls[1][1] == prompt


def test_edits_validate_whole_content_and_protect_provenance(questions):
    d = questions
    rows = generated(d)
    row = next(r for r in rows if r["type"] == "MULTIPLE_CHOICE")
    path = f"/questions/{row['id']}"
    for patch in [
        {"options": [{"text": "only", "is_correct": True}]},
        {"correct_answer": True},
        {"concept_ids": [str(uuid4())]},
        {"source_chunks": []},
        {"status": "APPROVED"},
        {"stem": None},
    ]:
        assert d.owner.patch(path, json=patch).status_code == 422
        assert d.owner.get(path).json() == row
    other = next(r for r in rows if r["id"] != row["id"])
    assert (
        d.owner.patch(path, json={"stem": "  " + other["stem"].upper() + "  "}).status_code == 409
    )
    patch = {
        "options": [{"text": "First", "is_correct": False}, {"text": "Second", "is_correct": True}],
        "difficulty": 5,
        "explanation": "Reviewed explanation",
        "concept_ids": [d.concept],
    }
    edited = d.owner.patch(path, json=patch).json()
    assert edited["options"][1]["is_correct"] and edited["difficulty"] == 5
    assert edited["source_chunks"] == row["source_chunks"]
    for item in rows:
        p = f"/questions/{item['id']}"
        d.owner.post(p + "/submit")
        d.owner.post(p + "/approve")
    public = d.member.get(d.bank + "?status=DRAFT&limit=2").json()
    assert len(public) == 2 and all(q["status"] == "APPROVED" for q in public)
    assert "is_correct" not in json.dumps(public)
    assert d.member.get(d.bank + "?limit=2&offset=2").json()[0]["id"] not in {
        q["id"] for q in public
    }
    for item in rows:
        d.owner.post(f"/questions/{item['id']}/archive")
    assert d.owner.post(d.generate, json=d.body).json()["status"] == "SUCCEEDED"
