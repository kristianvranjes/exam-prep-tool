"""Reset and seed only a disposable PostgreSQL E2E database.

Run explicitly with ``python -m app.e2e_seed`` inside the backend container.
This module is deliberately not registered as an HTTP route.
"""

import sys
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.config import Settings
from app.database import Base, make_engine
from app.models import User
from app.models.faculty import Faculty
from app.models.faculty_moderator import FacultyModerator
from app.services.auth import hash_password

FACULTY_ID = UUID("00000000-0000-0000-0000-00000000e2e0")
OWNER_ID = UUID("00000000-0000-0000-0000-00000000e2e1")
STUDENT_ID = UUID("00000000-0000-0000-0000-00000000e2e2")
FACULTY_SLUG = "exam-prep-e2e"
FACULTY_NAME = "E2E Faculty"
OWNER_EMAIL = "owner-e2e@example.com"
STUDENT_EMAIL = "student-e2e@example.com"
E2E_PASSWORD = "ExamPrepE2E!2026"


def validate_target(settings: Settings) -> None:
    """Reject every target except a test environment and an _e2e database."""
    database_name = make_url(settings.database_url).database or ""
    if settings.app_env != "test" or not database_name.endswith("_e2e"):
        raise ValueError("E2E seed requires APP_ENV=test and a PostgreSQL database ending in _e2e")


def reset_and_seed(settings: Settings) -> None:
    validate_target(settings)  # This must precede engine creation and every data mutation.
    engine = make_engine(settings)
    try:
        table_names = ", ".join(
            engine.dialect.identifier_preparer.format_table(table)
            for table in Base.metadata.tables.values()
        )
        with Session(engine) as db:
            db.execute(text(f"TRUNCATE TABLE {table_names} RESTART IDENTITY CASCADE"))
            db.add(
                Faculty(
                    id=FACULTY_ID,
                    name=FACULTY_NAME,
                    slug=FACULTY_SLUG,
                    university_name="Example Test University",
                    is_active=True,
                )
            )
            db.add_all(
                [
                    User(
                        id=OWNER_ID,
                        email=OWNER_EMAIL,
                        password_hash=hash_password(E2E_PASSWORD),
                        display_name="E2E Owner",
                        is_active=True,
                    ),
                    User(
                        id=STUDENT_ID,
                        email=STUDENT_EMAIL,
                        password_hash=hash_password(E2E_PASSWORD),
                        display_name="E2E Student",
                        is_active=True,
                    ),
                ]
            )
            db.flush()
            db.add(FacultyModerator(faculty_id=FACULTY_ID, user_id=OWNER_ID))
            db.commit()
    finally:
        engine.dispose()


def main() -> int:
    try:
        reset_and_seed(Settings())
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    except Exception:
        print("E2E seed failed; check the disposable database and migrations.", file=sys.stderr)
        return 1
    print(f"E2E seed ready: {FACULTY_SLUG}; {OWNER_EMAIL}; {STUDENT_EMAIL}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
