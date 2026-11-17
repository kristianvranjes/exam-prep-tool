import os
from uuid import UUID

import pytest
from community_helpers import archive_course, create_course, delete_course
from fastapi.testclient import TestClient
from pdf_fixture import make_pdf
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.config import Settings
from app.database import SessionLocal, engine
from app.main import app
from app.models import Course, CourseMembership
from app.models.material import Material
from app.models.material_chunk import MaterialChunk
from app.models.material_section import MaterialSection
from app.models.material_storage_cleanup import MaterialStorageCleanup
from app.services.materials import extraction, service
from app.services.materials.cleanup import cleanup_sources
from app.services.materials.storage import LocalMaterialStorage

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setenv("MATERIAL_STORAGE_DIR", str(tmp_path))
    with engine.begin() as connection:
        connection.execute(
            text("TRUNCATE material_storage_cleanups, course_memberships, courses, users CASCADE")
        )
    with TestClient(app) as owner, TestClient(app) as member, TestClient(app) as stranger:
        for client, name in ((owner, "owner"), (member, "member"), (stranger, "stranger")):
            response = client.post(
                "/auth/register",
                json={
                    "email": f"{name}@example.com",
                    "password": "correct horse",
                    "display_name": name,
                },
            )
            assert response.status_code == 201
        course_id = create_course(
            owner,
            json={"name": "Materials", "faculty_id": owner.get("/faculties").json()[0]["id"]},
        ).json()["id"]
        member_id = member.get("/auth/me").json()["id"]
        with SessionLocal() as db:
            db.add(
                CourseMembership(course_id=UUID(course_id), user_id=UUID(member_id), role="MEMBER")
            )
            db.commit()
        yield owner, member, stranger, course_id


def upload(client, course_id, data=None, filename="notes.pdf", mime="application/pdf"):
    return client.post(
        f"/courses/{course_id}/materials",
        files={"file": (filename, make_pdf() if data is None else data, mime)},
    )


def source_paths(course_id, root):
    storage = LocalMaterialStorage(root)
    with SessionLocal() as db:
        rows = list(
            db.scalars(
                select(Material).where(Material.course_id == UUID(course_id)).order_by(Material.id)
            )
        )
        return [(row.id, storage.path(row.storage_key)) for row in rows]


def test_course_delete_removes_all_sources_and_leaves_other_course(clients, tmp_path):
    owner, member, _, course_id = clients
    with SessionLocal() as db:
        faculty_id = db.get(Course, UUID(course_id)).faculty_id
    other = create_course(owner, json={"name": "Unrelated", "faculty_id": str(faculty_id)}).json()[
        "id"
    ]
    assert upload(owner, course_id).status_code == 201
    assert upload(owner, course_id).status_code == 201
    assert upload(owner, other).status_code == 201
    sources = source_paths(course_id, tmp_path)
    unrelated = source_paths(other, tmp_path)
    assert len(sources) == 2 and all(path.is_file() for _, path in sources)
    with SessionLocal() as db:
        db.get(Material, sources[1][0]).status = "FAILED"
        db.commit()
    assert len(unrelated) == 1 and unrelated[0][1].is_file()
    assert delete_course(owner, course_id).status_code == 204
    assert all(not path.exists() for _, path in sources)
    assert unrelated[0][1].is_file()
    with SessionLocal() as db:
        assert db.get(Course, UUID(course_id)) is None
        assert all(db.get(Material, material_id) is None for material_id, _ in sources)
        assert db.get(Course, UUID(other)) is not None
        assert db.get(Material, unrelated[0][0]) is not None
        assert db.scalar(select(func.count()).select_from(MaterialStorageCleanup)) == 0


def test_course_delete_storage_failure_commits_and_retries(clients, monkeypatch, tmp_path):
    owner, _, _, course_id = clients
    assert upload(owner, course_id).status_code == 201
    assert upload(owner, course_id).status_code == 201
    sources = source_paths(course_id, tmp_path)
    original_delete = LocalMaterialStorage.delete
    calls = 0

    def fail_second(self, key):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("private /storage/path and secret key")
        return original_delete(self, key)

    monkeypatch.setattr(LocalMaterialStorage, "delete", fail_second)
    response = delete_course(owner, course_id)
    assert response.status_code == 204 and response.content == b""
    assert "private" not in response.text and "secret" not in response.text
    assert all(path.name not in response.text for _, path in sources)
    assert sum(path.is_file() for _, path in sources) == 1
    with SessionLocal() as db:
        assert db.get(Course, UUID(course_id)) is None
        assert all(db.get(Material, material_id) is None for material_id, _ in sources)
        pending = db.scalars(select(MaterialStorageCleanup)).all()
        assert len(pending) == 1
        assert pending[0].attempt_count == 1 and pending[0].last_attempt_at is not None
        assert LocalMaterialStorage(tmp_path).path(pending[0].storage_key).is_file()
    monkeypatch.setattr(LocalMaterialStorage, "delete", original_delete)
    assert cleanup_sources(SessionLocal, LocalMaterialStorage(tmp_path)).cleaned == 1
    assert all(not path.exists() for _, path in sources)
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(MaterialStorageCleanup)) == 0


def test_course_delete_commit_failure_rolls_back_and_retries(clients, monkeypatch, tmp_path):
    owner, _, _, course_id = clients
    assert upload(owner, course_id).status_code == 201
    assert upload(owner, course_id).status_code == 201
    sources = source_paths(course_id, tmp_path)
    name = archive_course(owner, course_id)
    original_commit = Session.commit

    def fail_commit(self):
        self.flush()
        raise RuntimeError("private database failure")

    monkeypatch.setattr(Session, "commit", fail_commit)
    response = delete_course(owner, course_id, name)
    monkeypatch.setattr(Session, "commit", original_commit)
    assert response.status_code == 503 and "private" not in response.text
    assert len(sources) == 2 and all(path.is_file() for _, path in sources)
    with SessionLocal() as db:
        assert db.get(Course, UUID(course_id)) is not None
        assert all(db.get(Material, material_id) is not None for material_id, _ in sources)
        assert db.scalar(select(func.count()).select_from(MaterialStorageCleanup)) == 0
    assert delete_course(owner, course_id, name).status_code == 204
    with SessionLocal() as db:
        assert db.get(Course, UUID(course_id)) is None
    assert all(not path.exists() for _, path in sources)


def test_member_pdf_and_non_member_access(clients, tmp_path):
    owner, member, stranger, course_id = clients
    course_path = f"/courses/{course_id}/materials"
    with TestClient(app) as anonymous:
        assert anonymous.get(course_path).status_code == 401
        assert upload(anonymous, course_id).status_code == 401
    assert upload(stranger, course_id).status_code == 404
    assert stranger.get(course_path).status_code == 404
    # Members read materials; only the owner or a faculty moderator adds them.
    assert upload(member, course_id).status_code == 403
    assert member.get(course_path).json() == []
    assert not list(tmp_path.iterdir())
    response = upload(owner, course_id, filename="../../notes.pdf")
    assert response.status_code == 201
    material = response.json()
    assert material["status"] == "READY"
    assert material["original_filename"] == "notes.pdf"
    assert material["file_size_bytes"] == len(make_pdf())
    assert material["uploaded_by_user_id"] == owner.get("/auth/me").json()["id"]
    assert "storage_key" not in material
    path = f"/materials/{material['id']}"
    detail = member.get(path).json()
    assert "ExamPrep sample material" in detail["extracted_markdown"]
    assert detail["sections"]
    chunks = member.get(f"{path}/chunks").json()
    assert detail["chunk_count"] == len(chunks) > 0
    assert [c["ordinal"] for c in chunks] == list(range(len(chunks)))
    assert all(c["char_count"] == len(c["content"]) > 0 for c in chunks)
    assert owner.get(path).status_code == 200
    assert stranger.get(path).status_code == 404
    assert stranger.get(f"{path}/chunks").status_code == 404
    assert member.get(course_path).json()[0]["id"] == material["id"]
    with SessionLocal() as db:
        row = db.get(Material, UUID(material["id"]))
        storage = LocalMaterialStorage(tmp_path)
        assert storage.path(row.storage_key).read_bytes() == make_pdf()
        service.process_material(db, row, storage, Settings())
    assert member.get(f"{path}/chunks").json() == chunks


@pytest.mark.parametrize(
    "data,filename,mime,status",
    [
        (b"", "notes.pdf", "application/pdf", 400),
        (b"hello", "notes.txt", "text/plain", 415),
        (b"%PDF-fake", "notes.pdf", "text/plain", 415),
        (b"not a pdf", "notes.pdf", "application/pdf", 415),
    ],
)
def test_invalid_uploads(clients, tmp_path, data, filename, mime, status):
    owner, _, _, course_id = clients
    assert upload(owner, course_id, data, filename, mime).status_code == status
    assert not list(tmp_path.iterdir())


def test_upload_limit(clients, monkeypatch, tmp_path):
    owner, _, _, course_id = clients
    monkeypatch.setenv("MATERIAL_MAX_UPLOAD_BYTES", "10")
    assert upload(owner, course_id).status_code == 413
    assert not list(tmp_path.iterdir())


def test_parser_failure_retains_source_and_no_derived_rows(clients, monkeypatch, tmp_path):
    owner, _, _, course_id = clients

    def fail(path):
        raise RuntimeError("secret-password /private/path traceback")

    monkeypatch.setattr(extraction, "extract_document", fail)
    response = upload(owner, course_id)
    assert response.status_code == 201
    assert response.json()["status"] == "FAILED"
    assert "secret-password" not in response.text
    assert "traceback" not in response.text
    path = f"/materials/{response.json()['id']}"
    detail = owner.get(path).json()
    assert detail["extracted_markdown"] is None
    assert detail["sections"] == []
    assert detail["chunk_count"] == 0
    assert owner.get(f"{path}/chunks").json() == []
    assert len(list(tmp_path.iterdir())) == 1


def test_real_corrupt_pdf_fails_safely(clients):
    owner, _, _, course_id = clients
    response = upload(owner, course_id, b"%PDF-1.4\nbroken")
    assert response.status_code == 201
    assert response.json()["status"] == "FAILED"


def test_initial_db_failure_cleans_source(clients, monkeypatch, tmp_path):
    owner, _, _, course_id = clients

    def fail(self):
        raise RuntimeError("private database details")

    monkeypatch.setattr("sqlalchemy.orm.Session.commit", fail)
    response = upload(owner, course_id)
    assert response.status_code == 503
    assert "private" not in response.text
    assert not list(tmp_path.iterdir())


def test_derived_write_failure_rolls_back(clients, monkeypatch):
    owner, _, _, course_id = clients
    from sqlalchemy.orm import Session

    original = Session.add

    def fail_chunk(self, row, *args, **kwargs):
        if isinstance(row, MaterialChunk):
            raise RuntimeError("chunk persistence error")
        return original(self, row, *args, **kwargs)

    monkeypatch.setattr(Session, "add", fail_chunk)
    response = upload(owner, course_id)
    assert response.json()["status"] == "FAILED"
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(MaterialSection)) == 0
        assert db.scalar(select(func.count()).select_from(MaterialChunk)) == 0


def test_failed_material_delete_by_uploader(clients, monkeypatch, tmp_path):
    owner, _, _, course_id = clients

    def fail(path):
        raise RuntimeError("secret-password /private/path traceback")

    monkeypatch.setattr(extraction, "extract_document", fail)
    response = upload(owner, course_id)
    material = response.json()
    material_id = UUID(material["id"])
    assert response.status_code == 201
    assert material["status"] == "FAILED"

    delete_response = owner.delete(f"/materials/{material_id}")
    assert delete_response.status_code == 204
    assert delete_response.content == b""

    with SessionLocal() as db:
        assert db.get(Material, material_id) is None
        assert db.scalar(select(func.count()).select_from(MaterialStorageCleanup)) == 0
    assert not list(tmp_path.iterdir())


def test_failed_material_delete_permissions(clients, monkeypatch, tmp_path):
    owner, member, stranger, course_id = clients

    def fail(path):
        raise RuntimeError("secret-password /private/path traceback")

    monkeypatch.setattr(extraction, "extract_document", fail)
    response = upload(owner, course_id)
    material = response.json()
    material_id = UUID(material["id"])
    assert response.status_code == 201

    assert stranger.delete(f"/materials/{material_id}").status_code == 404
    assert member.delete(f"/materials/{material_id}").status_code == 403

    with SessionLocal() as db:
        assert db.get(Material, material_id) is not None
    assert len(list(tmp_path.iterdir())) == 1


def test_failed_material_delete_rejects_ready_material(clients, tmp_path):
    owner, _, _, course_id = clients
    response = upload(owner, course_id)
    material = response.json()
    assert response.status_code == 201
    assert material["status"] == "READY"

    delete_response = owner.delete(f"/materials/{material['id']}")
    assert delete_response.status_code == 409
    assert len(list(tmp_path.iterdir())) == 1

    with SessionLocal() as db:
        assert db.get(Material, UUID(material["id"])) is not None


def test_failed_material_delete_storage_failure_commits_and_retries(clients, monkeypatch, tmp_path):
    owner, _, _, course_id = clients

    def fail(path):
        raise RuntimeError("secret-password /private/path traceback")

    monkeypatch.setattr(extraction, "extract_document", fail)
    response = upload(owner, course_id)
    material = response.json()
    material_id = UUID(material["id"])
    assert response.status_code == 201

    def fail_delete(self, key):
        raise OSError("disk full /private/path secret")

    original_delete = LocalMaterialStorage.delete
    monkeypatch.setattr(LocalMaterialStorage, "delete", fail_delete)
    delete_response = owner.delete(f"/materials/{material_id}")
    assert delete_response.status_code == 204 and delete_response.content == b""
    assert "disk full" not in delete_response.text
    assert "private" not in delete_response.text

    with SessionLocal() as db:
        assert db.get(Material, material_id) is None
        pending = db.scalars(select(MaterialStorageCleanup)).all()
        assert len(pending) == 1
        assert pending[0].attempt_count == 1 and pending[0].last_attempt_at is not None
    assert len(list(tmp_path.iterdir())) == 1
    monkeypatch.setattr(LocalMaterialStorage, "delete", original_delete)
    assert cleanup_sources(SessionLocal, LocalMaterialStorage(tmp_path)).cleaned == 1
    assert not list(tmp_path.iterdir())
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(MaterialStorageCleanup)) == 0


def test_failed_material_delete_anonymous_requires_auth(clients, monkeypatch):
    owner, _, _, course_id = clients

    def fail(path):
        raise RuntimeError("secret-password /private/path traceback")

    monkeypatch.setattr(extraction, "extract_document", fail)
    response = upload(owner, course_id)
    material_id = UUID(response.json()["id"])

    with TestClient(app) as anonymous:
        assert anonymous.delete(f"/materials/{material_id}").status_code == 401

    with SessionLocal() as db:
        assert db.get(Material, material_id) is not None


@pytest.mark.parametrize("status", ["UPLOADED", "PROCESSING"])
def test_failed_material_delete_rejects_non_failed_statuses(clients, monkeypatch, status):
    owner, _, _, course_id = clients

    response = upload(owner, course_id)
    material_id = UUID(response.json()["id"])
    with SessionLocal() as db:
        row = db.get(Material, material_id)
        assert row is not None
        row.status = status
        db.commit()

    delete_response = owner.delete(f"/materials/{material_id}")
    assert delete_response.status_code == 409

    with SessionLocal() as db:
        assert db.get(Material, material_id) is not None


def test_failed_material_delete_db_failure_rolls_back_and_retry_is_safe(
    clients, monkeypatch, tmp_path
):
    owner, _, _, course_id = clients
    from sqlalchemy.orm import Session

    def fail(path):
        raise RuntimeError("secret-password /private/path traceback")

    monkeypatch.setattr(extraction, "extract_document", fail)
    response = upload(owner, course_id)
    material = response.json()
    material_id = UUID(material["id"])
    assert response.status_code == 201

    original_commit = Session.commit

    def fail_commit(self, *args, **kwargs):
        self.flush()
        raise RuntimeError("db commit blew up")

    monkeypatch.setattr(Session, "commit", fail_commit)
    delete_response = owner.delete(f"/materials/{material_id}")
    assert delete_response.status_code == 503
    assert "db commit blew up" not in delete_response.text

    with SessionLocal() as db:
        row = db.get(Material, material_id)
        assert row is not None
        storage = LocalMaterialStorage(tmp_path)
        assert storage.path(row.storage_key).is_file()
        assert db.scalar(select(func.count()).select_from(MaterialStorageCleanup)) == 0

    monkeypatch.setattr(Session, "commit", original_commit)
    retry_response = owner.delete(f"/materials/{material_id}")
    assert retry_response.status_code == 204

    with SessionLocal() as db:
        assert db.get(Material, material_id) is None


def test_failed_material_delete_duplicate_safe(clients, monkeypatch):
    owner, _, _, course_id = clients

    def fail(path):
        raise RuntimeError("secret-password /private/path traceback")

    monkeypatch.setattr(extraction, "extract_document", fail)
    response = upload(owner, course_id)
    material = response.json()
    material_id = UUID(material["id"])
    assert response.status_code == 201

    first = owner.delete(f"/materials/{material_id}")
    second = owner.delete(f"/materials/{material_id}")
    assert first.status_code == 204
    assert second.status_code == 404

    with SessionLocal() as db:
        assert db.get(Material, material_id) is None
