import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from io import BytesIO
from threading import Event
from uuid import UUID, uuid4

import pytest
from community_helpers import archive_course, delete_course
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from test_materials import clients as clients
from test_materials import source_paths, upload

from app.database import SessionLocal, engine
from app.models import Course
from app.models.material import Material
from app.models.material_storage_cleanup import MaterialStorageCleanup
from app.services.materials.cleanup import MAX_ATTEMPT_COUNT, cleanup_sources, queue_sources
from app.services.materials.storage import LocalMaterialStorage
from app.storage_cleanup import main

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


@pytest.fixture
def storage(tmp_path):
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE material_storage_cleanups"))
    yield LocalMaterialStorage(tmp_path)
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE material_storage_cleanups"))


def delete_target(owner, kind, course, material_id, name=None):
    """Delete the course the way the settings do (archived, then confirmed by name) or the material.

    Pass `name` when the course was archived beforehand, so the archive's own commit stays out
    of a test that counts or breaks commits.
    """
    if kind == "course":
        return delete_course(owner, course, name)
    return owner.delete(f"/materials/{material_id}")


def pending(storage, *, missing=False):
    key = f"{uuid4().hex}.pdf" if missing else storage.save(BytesIO(b"%PDF-test"), 100).key
    with SessionLocal() as db:
        cleanup_id = queue_sources(db, [key])[0]
        db.commit()
    return cleanup_id, key


def test_missing_file_and_repeated_cleanup_are_successful(storage):
    cleanup_id, _ = pending(storage, missing=True)
    assert cleanup_sources(SessionLocal, storage).cleaned == 1
    assert cleanup_sources(SessionLocal, storage, cleanup_ids=[cleanup_id]).cleaned == 0
    assert cleanup_sources(SessionLocal, storage).failed == 0
    with SessionLocal() as db:
        assert db.get(MaterialStorageCleanup, cleanup_id) is None


def test_uncommitted_intent_never_authorizes_storage_delete(storage):
    key = storage.save(BytesIO(b"%PDF-live"), 100).key
    with SessionLocal() as db:
        cleanup_id = queue_sources(db, [key])[0]
        db.flush()
        assert cleanup_sources(SessionLocal, storage, cleanup_ids=[cleanup_id]).cleaned == 0
        assert cleanup_sources(SessionLocal, storage).cleaned == 0
        db.rollback()
    assert storage.path(key).is_file()
    with SessionLocal() as db:
        assert db.get(MaterialStorageCleanup, cleanup_id) is None


def test_failure_metadata_retries_and_saturates_without_raw_errors(storage, monkeypatch):
    cleanup_id, key = pending(storage)
    original = storage.delete

    def fail(key):
        raise OSError("secret /private/path")

    monkeypatch.setattr(storage, "delete", fail)
    previous = None
    for count in (1, 2):
        assert cleanup_sources(SessionLocal, storage).failed == 1
        with SessionLocal() as db:
            row = db.get(MaterialStorageCleanup, cleanup_id)
            assert row.attempt_count == count
            assert row.last_attempt_at is not None
            assert previous is None or row.last_attempt_at > previous
            previous = row.last_attempt_at
            values = db.execute(text("SELECT * FROM material_storage_cleanups")).one()
            assert "secret" not in str(values) and "/private/path" not in str(values)
    with SessionLocal() as db:
        db.get(MaterialStorageCleanup, cleanup_id).attempt_count = MAX_ATTEMPT_COUNT
        db.commit()
    assert cleanup_sources(SessionLocal, storage).failed == 1
    with SessionLocal() as db:
        assert db.get(MaterialStorageCleanup, cleanup_id).attempt_count == MAX_ATTEMPT_COUNT
    assert storage.path(key).is_file()
    monkeypatch.setattr(storage, "delete", original)
    assert cleanup_sources(SessionLocal, storage).cleaned == 1
    assert not storage.path(key).exists()


def test_physical_success_then_cleanup_commit_failure_is_retryable(storage, monkeypatch):
    cleanup_id, key = pending(storage)
    original = Session.commit

    def fail(db):
        db.flush()
        raise RuntimeError("private DB failure")

    monkeypatch.setattr(Session, "commit", fail)
    assert cleanup_sources(SessionLocal, storage).failed == 1
    assert not storage.path(key).exists()
    with SessionLocal() as db:
        assert db.get(MaterialStorageCleanup, cleanup_id) is not None
    monkeypatch.setattr(Session, "commit", original)
    assert cleanup_sources(SessionLocal, storage).cleaned == 1
    with SessionLocal() as db:
        assert db.get(MaterialStorageCleanup, cleanup_id) is None


def test_bounded_oldest_first_with_id_tiebreak_and_unrelated_file(storage, monkeypatch):
    rows = [pending(storage) for _ in range(3)]
    unrelated = storage.save(BytesIO(b"%PDF-unrelated"), 100).key
    same_time = datetime.now(UTC) - timedelta(days=1)
    with SessionLocal() as db:
        for cleanup_id, _ in rows:
            db.get(MaterialStorageCleanup, cleanup_id).created_at = same_time
        newest_id, newest_key = min(rows)
        db.get(MaterialStorageCleanup, newest_id).created_at = same_time + timedelta(hours=1)
        db.commit()
    expected = [key for _, key in sorted(rows) if key != newest_key] + [newest_key]
    calls = []
    original = storage.delete

    def record(key):
        calls.append(key)
        original(key)

    monkeypatch.setattr(storage, "delete", record)
    assert cleanup_sources(SessionLocal, storage, batch_size=2).cleaned == 2
    assert calls == expected[:2]
    assert storage.path(newest_key).is_file() and storage.path(unrelated).is_file()
    assert cleanup_sources(SessionLocal, storage, batch_size=2).cleaned == 1
    assert calls == expected
    assert cleanup_sources(SessionLocal, storage, batch_size=2).cleaned == 0
    assert storage.path(unrelated).is_file()


def test_concurrent_cleanup_skips_locked_intent_and_repeated_retry_is_safe(storage, monkeypatch):
    cleanup_id, key = pending(storage)
    unrelated = storage.save(BytesIO(b"%PDF-unrelated"), 100).key
    entered, release = Event(), Event()
    original = storage.delete

    def hold(key):
        entered.set()
        assert release.wait(timeout=10)
        original(key)

    monkeypatch.setattr(storage, "delete", hold)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(cleanup_sources, SessionLocal, storage)
        try:
            assert entered.wait(timeout=10)
            second = pool.submit(cleanup_sources, SessionLocal, storage)
            assert second.result(timeout=10).cleaned == 0
        finally:
            release.set()
        assert first.result(timeout=10).cleaned == 1
    assert cleanup_sources(SessionLocal, storage, cleanup_ids=[cleanup_id]).cleaned == 0
    assert not storage.path(key).exists() and storage.path(unrelated).is_file()


@pytest.mark.parametrize("kind", ["course", "material"])
def test_crash_after_domain_commit_recovers_with_operator(
    clients, monkeypatch, tmp_path, kind, capsys
):
    owner, _, _, course = clients
    assert upload(owner, course).status_code == 201
    material_id, path = source_paths(course, tmp_path)[0]
    if kind == "material":
        with SessionLocal() as db:
            db.get(Material, material_id).status = "FAILED"
            db.commit()
    target = "app.services.courses" if kind == "course" else "app.services.materials.service"
    monkeypatch.setattr(target + ".cleanup_sources", lambda *a, **kw: None)
    assert delete_target(owner, kind, course, material_id).status_code == 204
    assert path.is_file()
    with SessionLocal() as db:
        assert db.get(Material, material_id) is None
        assert (db.get(Course, UUID(course)) is None) == (kind == "course")
        rows = db.scalars(select(MaterialStorageCleanup)).all()
        assert len(rows) == 1 and rows[0].attempt_count == 0
    assert main([]) == 0
    assert "Cleaned: 1; failed: 0; pending: 0" in capsys.readouterr().out
    assert not path.exists()
    assert main([]) == 0


def test_operator_bounds_safe_output_failure_and_retry(storage, monkeypatch, capsys):
    monkeypatch.setenv("MATERIAL_STORAGE_DIR", str(storage.root))
    rows = [pending(storage) for _ in range(2)]
    original = LocalMaterialStorage.delete

    def fail(self, key):
        raise OSError("secret /private/path " + key)

    monkeypatch.setattr(LocalMaterialStorage, "delete", fail)
    assert main(["--batch-size", "1"]) == 1
    output = capsys.readouterr().out
    assert output == "Cleaned: 0; failed: 1; pending: 2\n"
    assert all(key not in output for _, key in rows)
    monkeypatch.setattr(LocalMaterialStorage, "delete", original)
    assert main(["--batch-size", "1"]) == 1
    assert main(["--batch-size", "1"]) == 0
    assert main([]) == 0
    for size in ("0", "1001"):
        with pytest.raises(SystemExit) as exc:
            main(["--batch-size", size])
        assert exc.value.code == 2


def test_operator_db_failure_is_safe(monkeypatch, capsys):
    def fail():
        raise RuntimeError("secret /private/db")

    monkeypatch.setattr("app.database.SessionLocal", fail)
    assert main([]) == 1
    assert capsys.readouterr().out == "Cleanup unavailable; retry later.\n"


def test_operator_startup_configuration_failure_is_safe():
    result = subprocess.run(
        [sys.executable, "-m", "app.storage_cleanup"],
        env=os.environ | {"DATABASE_URL": "invalid-secret/private-path"},
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    assert result.returncode == 1
    assert result.stdout == "Cleanup unavailable; retry later.\n"
    assert result.stderr == ""


@pytest.mark.parametrize("kind", ["course", "material"])
def test_cleanup_commit_failure_does_not_change_logical_delete_success(
    clients, tmp_path, monkeypatch, kind
):
    owner, _, _, course = clients
    assert upload(owner, course).status_code == 201
    material_id, path = source_paths(course, tmp_path)[0]
    if kind == "material":
        with SessionLocal() as db:
            db.get(Material, material_id).status = "FAILED"
            db.commit()
    original = Session.commit
    calls = 0

    def fail_cleanup_commit(db):
        nonlocal calls
        calls += 1
        if calls == 2:
            db.flush()
            raise RuntimeError("secret /private/database")
        return original(db)

    name = archive_course(owner, course) if kind == "course" else None
    monkeypatch.setattr(Session, "commit", fail_cleanup_commit)
    response = delete_target(owner, kind, course, material_id, name)
    assert response.status_code == 204 and response.content == b""
    assert not path.exists()
    with SessionLocal() as db:
        assert db.get(Material, material_id) is None
        assert (db.get(Course, UUID(course)) is None) == (kind == "course")
        pending = db.scalars(select(MaterialStorageCleanup)).all()
        assert len(pending) == 1
    monkeypatch.setattr(Session, "commit", original)
    assert cleanup_sources(SessionLocal, LocalMaterialStorage(tmp_path)).cleaned == 1
    with SessionLocal() as db:
        assert db.scalars(select(MaterialStorageCleanup)).all() == []
