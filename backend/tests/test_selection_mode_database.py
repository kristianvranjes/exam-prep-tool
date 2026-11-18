"""How a session was started is recorded on the quiz for aggregate pilot metrics (0026)."""

import os
from datetime import UTC, datetime, timedelta

import pytest
from alembic.config import Config
from migration_helpers import legacy_rows
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from test_exam_scopes_database import draft, scope, unit
from test_materials import clients as clients
from test_paper_sessions_database import published, take
from test_practice_database import bank as bank
from test_practice_modes_database import add_progress, start, started

from alembic import command
from app.database import engine

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def recorded(attempt: dict) -> str | None:
    with engine.connect() as conn:
        return conn.scalar(
            text(
                "SELECT q.selection_mode FROM quizzes q "
                "JOIN quiz_attempts a ON a.quiz_id = q.id WHERE a.id = :id"
            ),
            {"id": attempt["id"]},
        )


def history() -> dict[str, list[object]]:
    with engine.connect() as conn:
        return {
            table: legacy_rows(conn, table)
            for table in ("quizzes", "quiz_questions", "quiz_attempts", "answers")
        }


def test_each_start_path_records_its_mode(clients):
    owner, member, _, course = clients
    first = unit(owner, course, "Unit 1")
    ids = [draft(member, course, f"Q{index}?", [first] if index < 2 else []) for index in range(8)]
    midterm = scope(
        owner, course, academic_year="2026/27", kind="MIDTERM", name="MI", unit_ids=[first]
    )
    now = datetime.now(UTC)
    add_progress(member, ids[2], now - timedelta(days=1))
    add_progress(member, ids[3], now + timedelta(days=3), last_result="INCORRECT")
    assert member.post(f"/courses/{course}/favorites/{ids[4]}").status_code == 200

    # Review modes skip sources in active sessions, so each finds its own question.
    # The one-click due review is an ordinary DUE start, so it records DUE as well.
    expected = {
        "DUE": started(member, course, 1, "DUE", feedback_mode="IMMEDIATE"),
        "MISTAKES": started(member, course, 1, "MISTAKES"),
        "FAVORITES": started(member, course, 1, "FAVORITES"),
        "MOCK": started(member, course, 1, "MOCK", exam_scope_id=midterm["id"]),
        "STANDARD": started(member, course, 1, "STANDARD", unit_ids=[first]),
        "ADAPTIVE": started(member, course, 1, "ADAPTIVE"),
        "QUICK": started(member, course, 1, "ADAPTIVE", feedback_mode="IMMEDIATE", quick_quiz=True),
    }
    for mode, attempt in expected.items():
        assert recorded(attempt) == mode, mode
        # Recorded for analytics only: the attempt payload does not carry it.
        assert "selection_mode" not in attempt and "quick_quiz" not in attempt
    quick = expected["QUICK"]
    assert quick["feedback_mode"] == "IMMEDIATE" and quick["paper"] is None

    # A quick quiz is an ADAPTIVE preset; any other mode is refused before selection.
    refused = start(member, course, 1, "STANDARD", quick_quiz=True)
    assert refused.status_code == 422
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM quizzes")) == len(expected)


def test_paper_sessions_record_paper(bank):
    owner, member, _, course, rows = bank
    _, path = published(owner, course, rows)
    exam = take(member, path)
    guided = take(member, path, feedback_mode="IMMEDIATE", timed=False)
    assert recorded(exam) == recorded(guided) == "PAPER"
    # Deleting the paper keeps the record: exam_paper_id is cleared, the mode stays.
    assert owner.post(path + "/unpublish").status_code == 200
    assert owner.delete(path).status_code == 204
    assert recorded(exam) == "PAPER"


def test_recorded_modes_are_checked(bank):
    owner, member, _, course, rows = bank
    _, path = published(owner, course, rows)
    paper = take(member, path)
    practice = started(member, course, 1, "STANDARD")
    assert recorded(practice) == "STANDARD"
    statement = text(
        "UPDATE quizzes SET selection_mode = :mode "
        "WHERE id = (SELECT quiz_id FROM quiz_attempts WHERE id = :id)"
    )
    for attempt, mode in [(practice, "UNKNOWN"), (practice, "PAPER"), (paper, "ADAPTIVE")]:
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(statement, {"mode": mode, "id": attempt["id"]})
    # Sessions from before 0026 stay unrecorded, whatever they were.
    with engine.begin() as conn:
        for attempt in (practice, paper):
            conn.execute(statement, {"mode": None, "id": attempt["id"]})
    assert recorded(practice) is recorded(paper) is None


def test_0026_roundtrip_keeps_sessions_and_leaves_older_ones_unrecorded(bank):
    owner, member, _, course, rows = bank
    _, path = published(owner, course, rows)
    paper = take(member, path)
    practice = started(member, course, 1, "STANDARD")
    before = history()
    config = Config("alembic.ini")
    try:
        for _ in range(2):
            command.downgrade(config, "0025")
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0025"
                columns = conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema = current_schema() AND table_name = 'quizzes'"
                    )
                ).scalars()
                assert "selection_mode" not in set(columns)
            assert history() == before
            command.upgrade(config, "head")
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0035"
            assert history() == before
            # No backfill: sessions that outlived the downgrade read as historic.
            assert recorded(paper) is recorded(practice) is None
            assert member.get(f"/courses/{course}/attempts/{practice['id']}").json() == practice
            # New starts record again.
            assert recorded(take(member, path)) == "PAPER"
            before = history()
    finally:
        command.upgrade(config, "head")
