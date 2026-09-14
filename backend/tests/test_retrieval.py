import os
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fake_embeddings import FakeEmbeddingProvider
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import CourseMembership
from app.models.material import Material
from app.models.material_chunk import MaterialChunk
from app.services.embeddings.base import content_hash
from app.services.embeddings.router import get_embedding_provider

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def add_material(course, user, texts):
    with SessionLocal() as db:
        material = Material(
            course_id=UUID(course),
            uploaded_by_user_id=UUID(user),
            original_filename="test.pdf",
            media_type="application/pdf",
            file_size_bytes=20,
            storage_key=f"{uuid4().hex}.pdf",
            status="READY",
        )
        db.add(material)
        db.flush()
        for ordinal, content in enumerate(texts):
            db.add(
                MaterialChunk(
                    material_id=material.id,
                    ordinal=ordinal,
                    content=content,
                    char_count=len(content),
                )
            )
        db.commit()
        return str(material.id)


@pytest.fixture
def data(monkeypatch):
    monkeypatch.setenv("EMBEDDING_BATCH_SIZE", "2")
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE users, courses, course_memberships CASCADE"))
    provider = FakeEmbeddingProvider()
    app.dependency_overrides[get_embedding_provider] = lambda: provider
    with TestClient(app) as owner, TestClient(app) as member, TestClient(app) as outsider:
        for client, name in [(owner, "owner"), (member, "member"), (outsider, "outsider")]:
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
        course = owner.post("/courses", json={"name": "Retrieval"}).json()["id"]
        member_id = member.get("/auth/me").json()["id"]
        with SessionLocal() as db:
            db.add(CourseMembership(course_id=UUID(course), user_id=UUID(member_id), role="MEMBER"))
            db.commit()
        material = add_material(course, member_id, ["alpha", "beta", "mixed"])
        try:
            yield SimpleNamespace(
                owner=owner,
                member=member,
                outsider=outsider,
                course=course,
                material=material,
                user=member_id,
                provider=provider,
                embed=f"/materials/{material}/embeddings",
                search=f"/courses/{course}/retrieval/search",
            )
        finally:
            app.dependency_overrides.pop(get_embedding_provider, None)


def test_embedding_order_idempotency_content_and_model_change(data):
    d = data
    first = d.member.post(d.embed)
    assert first.status_code == 200, first.text
    assert first.json()["embedded"] == 3
    assert d.provider.calls == [["alpha", "beta"], ["mixed"]]
    assert d.owner.post(d.embed).json()["skipped"] == 3
    assert len(d.provider.calls) == 2
    with SessionLocal() as db:
        chunk = db.scalar(
            select(MaterialChunk).where(
                MaterialChunk.material_id == UUID(d.material), MaterialChunk.ordinal == 0
            )
        )
        chunk.content = "alpha changed"
        chunk.char_count = len(chunk.content)
        db.commit()
    assert d.member.post(d.embed).json()["embedded"] == 1
    assert d.provider.calls[-1] == ["alpha changed"]
    d.provider.signature = "b" * 64
    assert d.member.post(d.embed).json()["embedded"] == 3
    with SessionLocal() as db:
        for chunk in db.scalars(
            select(MaterialChunk).where(MaterialChunk.material_id == UUID(d.material))
        ):
            assert chunk.embedding_signature == "b" * 64
            assert chunk.embedding_content_hash == content_hash(chunk.content)
            assert len(chunk.embedding) == 1024


@pytest.mark.parametrize("existing", [False, True])
def test_failure_rolls_back_whole_refresh(data, existing):
    d = data
    if existing:
        assert d.member.post(d.embed).status_code == 200
    with SessionLocal() as db:
        before = list(
            db.execute(
                select(
                    MaterialChunk.id, MaterialChunk.embedding_signature, MaterialChunk.embedded_at
                ).order_by(MaterialChunk.id)
            )
        )
    d.provider.signature = "b" * 64
    d.provider.fail_on = len(d.provider.calls) + 2
    response = d.member.post(d.embed)
    assert response.status_code == 503
    assert "private" not in response.text
    with SessionLocal() as db:
        assert (
            list(
                db.execute(
                    select(
                        MaterialChunk.id,
                        MaterialChunk.embedding_signature,
                        MaterialChunk.embedded_at,
                    ).order_by(MaterialChunk.id)
                )
            )
            == before
        )
    d.provider.fail_on = None
    assert d.member.post(d.search, json={"query": "alpha"}).json() == []
    assert d.member.post(d.embed).json()["embedded"] == 3


def test_search_order_cosine_ties_and_course_isolation(data):
    d = data
    other = d.outsider.post("/courses", json={"name": "Private"}).json()["id"]
    other_material = add_material(other, d.outsider.get("/auth/me").json()["id"], ["alpha"])
    assert d.outsider.post(f"/materials/{other_material}/embeddings").status_code == 200
    assert d.member.post(d.embed).status_code == 200
    response = d.member.post(d.search, json={"query": "alpha", "top_k": 3})
    assert response.status_code == 200, response.text
    hits = response.json()
    assert [hit["content"] for hit in hits] == ["alpha", "mixed", "beta"]
    assert [hit["distance"] for hit in hits] == pytest.approx([0, 1 - 2**-0.5, 1])
    assert all(hit["material_id"] == d.material for hit in hits)
    assert len(d.owner.post(d.search, json={"query": "beta", "top_k": 1}).json()) == 1
    assert d.owner.post(d.search, json={"query": "beta", "top_k": 1}).json()[0]["content"] == "beta"
    tied = add_material(d.course, d.user, ["alpha", "alpha"])
    d.member.post(f"/materials/{tied}/embeddings")
    hits = d.owner.post(d.search, json={"query": "alpha", "top_k": 3}).json()
    expected = sorted(hits, key=lambda hit: (hit["material_id"], hit["ordinal"], hit["chunk_id"]))
    assert hits == expected
    assert all(hit["distance"] == 0 for hit in hits)


def test_unembedded_stale_and_non_ready_are_excluded(data):
    d = data
    assert d.member.post(d.search, json={"query": "alpha"}).json() == []
    d.member.post(d.embed)
    with SessionLocal() as db:
        chunk = db.scalar(
            select(MaterialChunk).where(
                MaterialChunk.material_id == UUID(d.material), MaterialChunk.ordinal == 0
            )
        )
        chunk.content = "altered"
        chunk.char_count = 7
        db.commit()
    hits = d.member.post(d.search, json={"query": "alpha"}).json()
    assert len(hits) == 2
    assert all(hit["ordinal"] != 0 for hit in hits)
    d.provider.signature = "c" * 64
    assert d.member.post(d.search, json={"query": "alpha"}).json() == []
    d.provider.signature = "a" * 64
    with SessionLocal() as db:
        db.get(Material, UUID(d.material)).status = "FAILED"
        db.commit()
    assert d.member.post(d.search, json={"query": "alpha"}).json() == []
    calls = len(d.provider.calls)
    assert d.member.post(d.embed).status_code == 409
    assert len(d.provider.calls) == calls


def test_authorization_and_input_limits(data, monkeypatch):
    d = data
    with TestClient(app) as anonymous:
        assert anonymous.post(d.embed).status_code == 401
        assert anonymous.post(d.search, json={"query": "alpha"}).status_code == 401
    assert d.outsider.post(d.embed).status_code == 404
    assert d.outsider.post(d.search, json={"query": "alpha"}).status_code == 404
    assert d.member.post(f"/materials/{uuid4()}/embeddings").status_code == 404
    for payload in [
        {"query": " "},
        {"query": "x" * 1001},
        {"query": "x", "top_k": 0},
        {"query": "x", "top_k": 21},
        {"query": "x", "top_k": True},
    ]:
        assert d.member.post(d.search, json=payload).status_code == 422
    monkeypatch.setenv("EMBEDDING_MAX_CHUNKS", "2")
    assert d.member.post(d.embed).status_code == 422
    assert d.provider.calls == []


def test_provider_invalid_output_and_query_failure_are_safe(data, monkeypatch):
    d = data
    monkeypatch.setattr(d.provider, "embed", lambda texts: [[1.0]])
    for path, kwargs in [(d.embed, {}), (d.search, {"json": {"query": "alpha"}})]:
        assert d.member.post(path, **kwargs).status_code == 503
    with SessionLocal() as db:
        assert db.scalar(select(MaterialChunk.embedded_at).limit(1)) is None


def test_concurrent_embedding_refresh_is_rejected(data):
    d = data
    with SessionLocal() as db:
        db.scalar(select(Material).where(Material.id == UUID(d.material)).with_for_update())
        assert d.member.post(d.embed).status_code == 409
    assert d.provider.calls == []


def test_failed_changed_content_refresh_excludes_only_stale_rows(data):
    d = data
    d.member.post(d.embed)
    with SessionLocal() as db:
        chunk = db.scalar(
            select(MaterialChunk).where(
                MaterialChunk.material_id == UUID(d.material), MaterialChunk.ordinal == 0
            )
        )
        chunk.content = "changed"
        chunk.char_count = 7
        db.commit()
    d.provider.fail_on = len(d.provider.calls) + 1
    assert d.member.post(d.embed).status_code == 503
    d.provider.fail_on = None
    hits = d.member.post(d.search, json={"query": "alpha"}).json()
    assert len(hits) == 2
    assert {hit["ordinal"] for hit in hits} == {1, 2}


def test_database_failure_does_not_commit_any_vectors(data, monkeypatch):
    from sqlalchemy.orm import Session

    original = Session.flush

    def fail_after_flush(self, *args, **kwargs):
        writing = any(isinstance(row, MaterialChunk) for row in self.dirty)
        original(self, *args, **kwargs)
        if writing:
            raise RuntimeError("private database details")

    monkeypatch.setattr(Session, "flush", fail_after_flush)
    response = data.member.post(data.embed)
    assert response.status_code == 503
    assert "private" not in response.text
    with SessionLocal() as db:
        assert all(value is None for value in db.scalars(select(MaterialChunk.embedded_at)))


def test_vector_constraints_and_model_migration_parity(data):
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    from sqlalchemy.exc import DBAPIError, StatementError

    with engine.connect() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "include_object": lambda obj, name, type_, reflected, compare_to: (
                    type_ != "table" or name == "material_chunks"
                )
            },
        )
        assert compare_metadata(context, Base.metadata) == []
    with SessionLocal() as db:
        chunk = db.scalar(select(MaterialChunk).limit(1))
        chunk.embedding = [1.0, 0.0]
        chunk.embedding_signature = "a" * 64
        chunk.embedding_content_hash = content_hash(chunk.content)
        chunk.embedded_at = datetime.now(UTC)
        with pytest.raises((DBAPIError, StatementError)):
            db.commit()
        db.rollback()
        with pytest.raises(DBAPIError):
            db.execute(text("UPDATE material_chunks SET embedded_at = now()"))
            db.commit()
        db.rollback()
        with pytest.raises(DBAPIError):
            db.execute(text("UPDATE material_chunks SET embedding = '[1,0]'::vector"))
        db.rollback()
