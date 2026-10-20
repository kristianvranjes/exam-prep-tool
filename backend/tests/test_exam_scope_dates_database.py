import os

import pytest
from alembic.config import Config
from sqlalchemy import text
from test_exam_scopes_database import scope, unit
from test_materials import clients as clients
from test_practice_database import bank as bank
from test_practice_database import save_all, start

from alembic import command
from app.database import engine

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

BODY = {"academic_year": "2026/27", "kind": "MIDTERM", "name": "Međuispit"}


def test_scope_dates_kinds_update_and_copy(clients):
    owner, member, _, course = clients
    first = unit(owner, course, "Logika")
    created = scope(
        owner, course, **BODY, unit_ids=[first], starts_on="2026-11-23", ends_on="2026-12-01"
    )
    assert (created["starts_on"], created["ends_on"]) == ("2026-11-23", "2026-12-01")
    lab = scope(owner, course, **BODY | {"kind": "LAB", "name": "Lab 1"}, unit_ids=[first])
    blic = scope(owner, course, **BODY | {"kind": "QUIZ", "name": "Blic 1"}, unit_ids=[first])
    assert lab["starts_on"] is None and blic["kind"] == "QUIZ"
    listed = member.get(f"/courses/{course}/exam-scopes").json()
    assert [row["kind"] for row in listed] == ["MIDTERM", "LAB", "QUIZ"]
    path = f"/exam-scopes/{created['id']}"
    # Ending before the current start, or ending without a start, is rejected.
    assert owner.patch(path, json={"ends_on": "2026-11-01"}).status_code == 422
    assert owner.patch(path, json={"starts_on": None}).status_code == 422
    cleared = owner.patch(path, json={"starts_on": None, "ends_on": None})
    assert cleared.status_code == 200, cleared.text
    assert (cleared.json()["starts_on"], cleared.json()["ends_on"]) == (None, None)
    moved = owner.patch(path, json={"starts_on": "2026-11-24"}).json()
    assert (moved["starts_on"], moved["ends_on"], moved["name"]) == (
        "2026-11-24",
        None,
        "Međuispit",
    )
    copied = owner.post(
        f"/courses/{course}/exam-scopes/copy", json={"from_year": "2026/27", "to_year": "2027/28"}
    )
    assert copied.status_code == 201, copied.text
    assert {row["kind"] for row in copied.json()} == {"MIDTERM", "LAB", "QUIZ"}
    assert all(row["starts_on"] is None for row in copied.json())


def test_coverage_counts_reviewed_scope_questions(bank):
    owner, member, stranger, course, rows = bank
    first = unit(owner, course, "Logika")
    second = unit(owner, course, "Skupovi")
    linked = rows[:2]
    for row, unit_id in zip(linked, (first, second), strict=True):
        response = owner.post(
            f"/courses/{course}/questions/units",
            json={"question_ids": [row["id"]], "unit_id": unit_id, "action": "ADD"},
        )
        assert response.status_code == 200, response.text
    mi = scope(owner, course, **BODY, unit_ids=[first, second])
    only_first = scope(owner, course, **BODY | {"name": "Lab"}, unit_ids=[first])
    path = f"/exam-scopes/{mi['id']}/coverage"
    assert member.get(path).json() == {
        "scope_id": mi["id"],
        "question_count": 2,
        "reviewed_count": 0,
    }
    assert stranger.get(path).status_code == 404
    assert member.get(f"/exam-scopes/{only_first['id']}/coverage").json()["question_count"] == 1
    attempt = start(member, course, count=len(rows))
    member.post(save_all(member, course, attempt) + "/submit")
    objective = [row for row in linked if row["type"] != "SHORT_ANSWER"]
    assert member.get(path).json()["reviewed_count"] == len(objective)
    # Coverage is personal: the owner has reviewed nothing.
    assert owner.get(path).json()["reviewed_count"] == 0


def test_0019_downgrade_keeps_dated_cycles_but_refuses_lab_and_quiz(clients):
    owner, _, _, course = clients
    first = unit(owner, course, "Logika")
    scope(owner, course, **BODY, unit_ids=[first], starts_on="2026-11-23")
    lab = scope(owner, course, **BODY | {"kind": "LAB", "name": "Lab 1"}, unit_ids=[first])
    config = Config("alembic.ini")
    try:
        with pytest.raises(RuntimeError, match="lab or quiz"):
            command.downgrade(config, "0018")
        assert owner.delete(f"/exam-scopes/{lab['id']}").status_code == 204
        command.downgrade(config, "0018")
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT count(*) FROM exam_scopes")) == 1
        command.upgrade(config, "head")
        assert owner.get(f"/courses/{course}/exam-scopes").json()[0]["starts_on"] is None
    finally:
        command.upgrade(config, "head")
