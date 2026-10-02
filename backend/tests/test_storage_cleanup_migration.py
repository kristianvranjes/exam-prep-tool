import os
from uuid import UUID, uuid4

import pytest
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateTable
from test_community_database import community as community
from test_faculties_database import historical_rows
from test_materials import clients as clients
from test_materials import source_paths, upload
from test_practice_database import save_all, start
from test_question_reports_database import BODY, approved
from test_question_suggestions_database import submit

from alembic import command
from app.database import Base, SessionLocal, engine
from app.models.material import Material
from app.models.material_storage_cleanup import MaterialStorageCleanup

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def application_rows():
    rows = historical_rows()
    with engine.connect() as conn:
        for table in ("question_reports", "question_edit_suggestions"):
            rows[table] = conn.execute(text(f"SELECT * FROM {table} ORDER BY id")).all()
    return rows


def test_0014_roundtrip_preserves_domain_history_and_never_restores_sources(
    community, tmp_path, monkeypatch
):
    _, creator, moderator, course, _, _ = community
    question = approved(creator, moderator, course)
    assert creator.post(question + "/reports", json=BODY).status_code == 201
    submit(creator, question)
    attempt = start(creator, course, count=1)
    assert creator.post(save_all(creator, course, attempt) + "/submit").status_code == 200
    assert upload(creator, course).status_code == 201
    live_id, live_path = source_paths(course, tmp_path)[0]
    response = upload(creator, course, data=b"%PDF-broken")
    deleted_id = UUID(response.json()["id"])
    deleted_path = next(
        path for row_id, path in source_paths(course, tmp_path) if row_id == deleted_id
    )
    monkeypatch.setattr("app.services.materials.service.cleanup_sources", lambda *a, **kw: None)
    assert creator.delete(f"/materials/{deleted_id}").status_code == 204
    before = application_rows()
    for table in (
        "materials",
        "questions",
        "question_versions",
        "question_reports",
        "question_edit_suggestions",
        "quizzes",
        "answers",
        "question_review_progress",
    ):
        assert before[table]
    files = {path: path.read_bytes() for path in (live_path, deleted_path)}
    config = Config("alembic.ini")
    try:
        with SessionLocal() as db:
            assert db.query(MaterialStorageCleanup).count() == 1
        command.downgrade(config, "0013")
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0013"
            assert conn.scalar(text("SELECT to_regclass('material_storage_cleanups')")) is None
        assert application_rows() == before
        command.upgrade(config, "0014")
        assert application_rows() == before
        command.downgrade(config, "0013")
        command.upgrade(config, "0014")
        assert application_rows() == before
        with SessionLocal() as db:
            assert db.get(Material, live_id) is not None
            assert db.get(Material, deleted_id) is None
            assert db.query(MaterialStorageCleanup).count() == 0
        assert {path: path.read_bytes() for path in files} == files
    finally:
        command.upgrade(config, "head")


def test_cleanup_model_migration_parity_constraints_defaults_and_queue_index():
    table = "material_storage_cleanups"
    with engine.begin() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "compare_server_default": True,
                "include_object": lambda obj, name, type_, reflected, compare_to: (
                    type_ != "table" or name == table
                ),
            },
        )
        assert compare_metadata(context, Base.metadata) == []
        ddl = str(CreateTable(MaterialStorageCleanup.__table__).compile(engine))
        conn.execute(
            text(ddl.replace("CREATE TABLE " + table, "CREATE TABLE cleanup_model_contract"))
        )
        definitions = text(
            "SELECT contype, pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conrelid = to_regclass(:table) ORDER BY contype, pg_get_constraintdef(oid)"
        )
        assert (
            conn.execute(definitions, {"table": table}).all()
            == conn.execute(definitions, {"table": "cleanup_model_contract"}).all()
        )
        conn.execute(text("DROP TABLE cleanup_model_contract"))
        inspector = inspect(conn)
        assert inspector.get_foreign_keys(table) == []
        queue = next(
            i
            for i in inspector.get_indexes(table)
            if i["name"] == "ix_material_storage_cleanups_queue"
        )
        assert queue["column_names"] == ["created_at", "id"]
        assert not queue["unique"]
        columns = {c["name"]: c for c in inspector.get_columns(table)}
        assert set(columns) == {
            "id",
            "storage_key",
            "attempt_count",
            "last_attempt_at",
            "created_at",
        }
        assert columns["storage_key"]["type"].length == 100
        assert columns["created_at"]["type"].timezone
        assert columns["last_attempt_at"]["type"].timezone


def test_cleanup_constraints_and_server_defaults():
    key = f"{uuid4().hex}.pdf"
    with SessionLocal() as db:
        row = MaterialStorageCleanup(storage_key=key)
        db.add(row)
        db.flush()
        assert row.attempt_count == 0 and row.created_at is not None
        assert row.last_attempt_at is None
        for values in (
            {"storage_key": key},
            {"storage_key": f"{uuid4().hex}.pdf", "attempt_count": -1},
        ):
            with pytest.raises(IntegrityError), db.begin_nested():
                db.add(MaterialStorageCleanup(**values))
                db.flush()
        insert = text(
            "INSERT INTO material_storage_cleanups (id, storage_key, attempt_count, created_at) "
            "VALUES (:id, :key, :count, :created)"
        )
        common = {"id": uuid4(), "key": f"{uuid4().hex}.pdf", "count": 0, "created": row.created_at}
        for field in ("id", "key", "count", "created"):
            with pytest.raises(IntegrityError), db.begin_nested():
                db.execute(insert, common | {field: None})
        db.add(MaterialStorageCleanup(storage_key=f"{uuid4().hex}.pdf", attempt_count=3))
        db.flush()
        db.rollback()
