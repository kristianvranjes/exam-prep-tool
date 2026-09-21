import os
from uuid import UUID

import pytest
from community_helpers import create_course
from fastapi.testclient import TestClient
from pdf_fixture import make_pdf
from sqlalchemy import func, select, text

from app.config import Settings
from app.database import SessionLocal, engine
from app.main import app
from app.models import CourseMembership
from app.models.material import Material
from app.models.material_chunk import MaterialChunk
from app.models.material_section import MaterialSection
from app.services.materials import extraction, service
from app.services.materials.storage import LocalMaterialStorage

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setenv("MATERIAL_STORAGE_DIR", str(tmp_path))
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE course_memberships, courses, users CASCADE"))
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


def test_member_pdf_and_non_member_access(clients, tmp_path):
    owner, member, stranger, course_id = clients
    course_path = f"/courses/{course_id}/materials"
    with TestClient(app) as anonymous:
        assert anonymous.get(course_path).status_code == 401
        assert upload(anonymous, course_id).status_code == 401
    assert upload(stranger, course_id).status_code == 404
    assert stranger.get(course_path).status_code == 404
    response = upload(member, course_id, filename="../../notes.pdf")
    assert response.status_code == 201
    material = response.json()
    assert material["status"] == "READY"
    assert material["original_filename"] == "notes.pdf"
    assert material["file_size_bytes"] == len(make_pdf())
    assert material["uploaded_by_user_id"] == member.get("/auth/me").json()["id"]
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
    _, member, _, course_id = clients
    assert upload(member, course_id, data, filename, mime).status_code == status
    assert not list(tmp_path.iterdir())


def test_upload_limit(clients, monkeypatch, tmp_path):
    _, member, _, course_id = clients
    monkeypatch.setenv("MATERIAL_MAX_UPLOAD_BYTES", "10")
    assert upload(member, course_id).status_code == 413
    assert not list(tmp_path.iterdir())


def test_parser_failure_retains_source_and_no_derived_rows(clients, monkeypatch, tmp_path):
    _, member, _, course_id = clients

    def fail(path):
        raise RuntimeError("secret-password /private/path traceback")

    monkeypatch.setattr(extraction, "extract_document", fail)
    response = upload(member, course_id)
    assert response.status_code == 201
    assert response.json()["status"] == "FAILED"
    assert "secret-password" not in response.text
    assert "traceback" not in response.text
    path = f"/materials/{response.json()['id']}"
    detail = member.get(path).json()
    assert detail["extracted_markdown"] is None
    assert detail["sections"] == []
    assert detail["chunk_count"] == 0
    assert member.get(f"{path}/chunks").json() == []
    assert len(list(tmp_path.iterdir())) == 1


def test_real_corrupt_pdf_fails_safely(clients):
    _, member, _, course_id = clients
    response = upload(member, course_id, b"%PDF-1.4\nbroken")
    assert response.status_code == 201
    assert response.json()["status"] == "FAILED"


def test_initial_db_failure_cleans_source(clients, monkeypatch, tmp_path):
    _, member, _, course_id = clients

    def fail(self):
        raise RuntimeError("private database details")

    monkeypatch.setattr("sqlalchemy.orm.Session.commit", fail)
    response = upload(member, course_id)
    assert response.status_code == 503
    assert "private" not in response.text
    assert not list(tmp_path.iterdir())


def test_derived_write_failure_rolls_back(clients, monkeypatch):
    _, member, _, course_id = clients
    from sqlalchemy.orm import Session

    original = Session.add

    def fail_chunk(self, row, *args, **kwargs):
        if isinstance(row, MaterialChunk):
            raise RuntimeError("chunk persistence error")
        return original(self, row, *args, **kwargs)

    monkeypatch.setattr(Session, "add", fail_chunk)
    response = upload(member, course_id)
    assert response.json()["status"] == "FAILED"
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(MaterialSection)) == 0
        assert db.scalar(select(func.count()).select_from(MaterialChunk)) == 0
