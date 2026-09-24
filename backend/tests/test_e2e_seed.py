"""Safety checks for the explicit disposable E2E database seed."""

import os

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app import e2e_seed
from app.config import Settings
from app.database import make_engine
from app.models import Course, User
from app.models.faculty import Faculty
from app.models.faculty_moderator import FacultyModerator
from app.services.auth import verify_password


def settings(environment: str, database_name: str) -> Settings:
    return Settings(
        _env_file=None,
        app_env=environment,
        database_url=f"postgresql+psycopg://examprep:examprep@localhost:5432/{database_name}",
    )


def test_seed_refuses_non_test_environment_before_db_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(e2e_seed, "make_engine", lambda _: pytest.fail("database accessed"))
    with pytest.raises(ValueError, match="APP_ENV=test"):
        e2e_seed.reset_and_seed(settings("development", "disposable_e2e"))


def test_seed_refuses_non_e2e_database_before_db_access(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(e2e_seed, "make_engine", lambda _: pytest.fail("database accessed"))
    with pytest.raises(ValueError, match="ending in _e2e"):
        e2e_seed.reset_and_seed(settings("test", "developer_db"))


@pytest.mark.integration
@pytest.mark.skipif(
    os.getenv("RUN_DB_TESTS") != "1" or os.getenv("RUN_E2E_SEED_TESTS") != "1",
    reason="Requires an explicitly selected disposable _e2e PostgreSQL database",
)
def test_seed_is_guarded_complete_and_repeatable() -> None:
    database_url = os.environ["DATABASE_URL"]
    assert (make_url(database_url).database or "").endswith("_e2e")
    target = Settings(_env_file=None, app_env="test", database_url=database_url)
    engine = make_engine(target)
    try:
        with Session(engine) as db:
            migration = db.scalar(text("SELECT version_num FROM alembic_version"))
        assert migration
        for _ in range(2):
            e2e_seed.reset_and_seed(target)
            with Session(engine) as db:
                faculty = db.get(Faculty, e2e_seed.FACULTY_ID)
                owner = db.get(User, e2e_seed.OWNER_ID)
                student = db.get(User, e2e_seed.STUDENT_ID)
                assert faculty and faculty.slug == e2e_seed.FACULTY_SLUG and faculty.is_active
                assert owner and owner.email == e2e_seed.OWNER_EMAIL
                assert student and student.email == e2e_seed.STUDENT_EMAIL
                assert verify_password(e2e_seed.E2E_PASSWORD, owner.password_hash)
                assert verify_password(e2e_seed.E2E_PASSWORD, student.password_hash)
                assert db.get(FacultyModerator, (e2e_seed.FACULTY_ID, e2e_seed.OWNER_ID))
                assert db.scalar(select(func.count()).select_from(Faculty)) == 1
                assert db.scalar(select(func.count()).select_from(User)) == 2
                assert db.scalar(select(func.count()).select_from(Course)) == 0
                assert db.scalar(text("SELECT version_num FROM alembic_version")) == migration
    finally:
        engine.dispose()
