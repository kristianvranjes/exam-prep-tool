import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateTable
from test_community_database import community as community
from test_materials import clients as clients
from test_question_reports_database import BODY, approved, question_history
from test_question_suggestions_database import decide, rows_for, submit

from alembic import command
from app.database import Base, SessionLocal, engine
from app.models.question_edit_suggestion import QuestionEditSuggestion

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def test_0013_upgrade_downgrade_preserves_applied_content_versions_and_reports(community):
    _, creator, moderator, course, _, _ = community
    path = approved(creator, moderator, course)
    assert creator.post(path + "/reports", json=BODY).status_code == 201
    config = Config("alembic.ini")
    question_id = UUID(path.split("/")[2])
    before = question_history(question_id)
    reports = rows_for(question_id, "question_reports")
    try:
        command.downgrade(config, "0012")
        assert question_history(question_id) == before
        assert rows_for(question_id, "question_reports") == reports
        # The current API also uses tables newer than 0013, so exercise it at head;
        # downgrading to 0012 still rolls back through 0013 below.
        command.upgrade(config, "head")
        assert question_history(question_id) == before
        assert rows_for(question_id, "question_reports") == reports
        receipt = submit(
            creator,
            path,
            {
                "changes": {
                    "stem": "Applied migration correction " + uuid4().hex,
                    "correct_answer": False,
                }
            },
        )
        assert decide(moderator, receipt).status_code == 200
        applied = question_history(question_id)
        assert applied[0] != before[0]
        assert len(applied[1]) == len(before[1]) + 1
        assert applied[1][-1].reason == "EDITED"
        command.downgrade(config, "0012")
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0012"
            assert conn.scalar(text("SELECT to_regclass('question_edit_suggestions')")) is None
        assert question_history(question_id) == applied
        assert rows_for(question_id, "question_reports") == reports
        command.upgrade(config, "head")
        assert question_history(question_id) == applied
        assert rows_for(question_id, "question_reports") == reports
        assert submit(creator, path)["base_version_number"] == 4
    finally:
        command.upgrade(config, "head")


def test_model_migration_constraint_and_index_parity():
    with engine.begin() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "compare_server_default": True,
                "include_object": lambda obj, name, type_, reflected, compare_to: (
                    type_ != "table" or name == "question_edit_suggestions"
                ),
            },
        )
        assert compare_metadata(context, Base.metadata) == []
        # Alembic does not compare CHECK expressions. Compile the model's DDL into
        # a disposable contract table and compare PostgreSQL's normalized checks/FKs.
        ddl = str(CreateTable(QuestionEditSuggestion.__table__).compile(engine))
        conn.execute(
            text(
                ddl.replace(
                    "CREATE TABLE question_edit_suggestions",
                    "CREATE TABLE suggestion_model_contract",
                )
            )
        )
        definitions = text(
            "SELECT contype, pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conrelid = to_regclass(:table) "
            "ORDER BY contype, pg_get_constraintdef(oid)"
        )
        assert (
            conn.execute(definitions, {"table": "suggestion_model_contract"}).all()
            == conn.execute(definitions, {"table": "question_edit_suggestions"}).all()
        )
        conn.execute(text("DROP TABLE suggestion_model_contract"))


def test_db_rejects_invalid_suggestion_metadata_and_accepts_valid_resolutions(community):
    owner, creator, moderator, course, _, _ = community
    path = approved(creator, moderator, course)
    common = {
        "question_id": UUID(path.split("/")[2]),
        "suggested_by_user_id": UUID(owner.get("/auth/me").json()["id"]),
        "base_version_number": 3,
        "proposed_content": {"type": "TRUE_FALSE", "stem": "Statement", "correct_answer": True},
    }
    invalid = [
        {"base_version_number": 0},
        {"proposed_content": []},
        {"proposed_content": None},
        {"note": " "},
        {"note": "x" * 1001},
        {"status": "INVALID"},
        {"resolution": "APPLIED"},
        {"resolution_reason": "No"},
        {"resolved_at": datetime.now(UTC)},
        {"resolved_by_user_id": common["suggested_by_user_id"]},
        {"applied_version_number": 4},
        {"status": "RESOLVED"},
        {"status": "RESOLVED", "resolved_at": datetime.now(UTC)},
    ]
    resolved = {"status": "RESOLVED", "resolved_at": datetime.now(UTC)}
    invalid += [
        resolved | item
        for item in (
            {"resolution": "INVALID"},
            {"resolution": "APPLIED"},
            {"resolution": "APPLIED", "applied_version_number": 0},
            {"resolution": "APPLIED", "applied_version_number": 4, "resolution_reason": "No"},
            {"resolution": "REJECTED"},
            {"resolution": "REJECTED", "resolution_reason": " "},
            {"resolution": "REJECTED", "resolution_reason": "x" * 1001},
            {"resolution": "REJECTED", "resolution_reason": "No", "applied_version_number": 4},
            {"resolution": "SUPERSEDED", "applied_version_number": 4},
            {"resolution": "SUPERSEDED", "resolution_reason": "No"},
            {"resolution": "QUESTION_ARCHIVED", "applied_version_number": 4},
            {"resolution": "QUESTION_ARCHIVED", "resolution_reason": "No"},
        )
    ]
    with SessionLocal() as db:
        for change in invalid:
            with pytest.raises(IntegrityError), db.begin_nested():
                db.add(QuestionEditSuggestion(**(common | change)))
                db.flush()
        for change in (
            {},
            resolved | {"resolution": "APPLIED", "applied_version_number": 4},
            resolved | {"resolution": "REJECTED", "resolution_reason": "No"},
            resolved | {"resolution": "SUPERSEDED"},
            resolved | {"resolution": "QUESTION_ARCHIVED"},
        ):
            db.add(QuestionEditSuggestion(**(common | change)))
            db.flush()
        db.commit()
        with pytest.raises(IntegrityError), db.begin_nested():
            db.add(QuestionEditSuggestion(**common))
            db.flush()


def test_partial_unique_index_protects_concurrent_direct_inserts(community):
    owner, creator, moderator, course, _, _ = community
    path = approved(creator, moderator, course)
    barrier = Barrier(2)
    question_id = UUID(path.split("/")[2])
    user_id = UUID(owner.get("/auth/me").json()["id"])

    def insert(_):
        with SessionLocal() as db:
            db.add(
                QuestionEditSuggestion(
                    question_id=question_id,
                    suggested_by_user_id=user_id,
                    base_version_number=3,
                    proposed_content={},
                )
            )
            barrier.wait(timeout=10)
            try:
                db.commit()
                return "created"
            except IntegrityError as exc:
                db.rollback()
                assert exc.orig.diag.constraint_name == "uq_question_suggestion_open"
                return "duplicate"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(insert, range(2))) == ["created", "duplicate"]
