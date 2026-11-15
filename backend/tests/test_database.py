import os

import pytest
from sqlalchemy import text

from app.database import engine
from app.services.health import check_database


@pytest.mark.integration
@pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Set RUN_DB_TESTS=1 with PostgreSQL")
def test_database_and_migration() -> None:
    assert check_database(engine).status == "ok"
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT extname FROM pg_extension WHERE extname='vector'"))
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0031"
