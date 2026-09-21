import os

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect

from app.database import Base, engine

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def test_question_migration_parity():
    tables = {
        "questions",
        "question_options",
        "question_concepts",
        "question_chunks",
        "question_versions",
        "ai_jobs",
    }
    with engine.connect() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "include_object": lambda obj, name, type_, reflected, compare_to: (
                    type_ != "table" or name in tables
                )
            },
        )
        assert compare_metadata(context, Base.metadata) == []
        assert "uq_question_creator_active_stem" in {
            i["name"] for i in inspect(conn).get_indexes("questions")
        }
