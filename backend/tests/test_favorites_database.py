import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from community_helpers import create_course, review_question
from migration_helpers import legacy_rows
from sqlalchemy import text, update
from test_exam_scopes_database import draft, scope, unit
from test_materials import clients as clients
from test_practice_modes_database import answer_and_submit, available, start, started, stems

from alembic import command
from app.database import Base, SessionLocal, engine
from app.models.question_favorite import QuestionFavorite

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def add(client, course, question):
    return client.post(f"/courses/{course}/favorites/{question}")


def remove(client, course, question):
    return client.delete(f"/courses/{course}/favorites/{question}")


def favorites(client, course, **params):
    response = client.get(f"/courses/{course}/favorites", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def approved(owner, course, stem, unit_ids):
    question = draft(owner, course, stem, unit_ids)
    assert owner.post(f"/questions/{question}/submit").status_code == 200
    assert review_question(owner, f"/questions/{question}/approve").status_code == 200
    return question


def favorited_at(client, question_ids, when):
    user_id = UUID(client.get("/auth/me").json()["id"])
    with SessionLocal() as db:
        db.execute(
            update(QuestionFavorite)
            .where(
                QuestionFavorite.user_id == user_id,
                QuestionFavorite.question_id.in_([UUID(id_) for id_ in question_ids]),
            )
            .values(created_at=when)
        )
        db.commit()


def history():
    """Everything an attempt is made of, which favorites must never touch."""
    with engine.connect() as conn:
        return {
            table: legacy_rows(conn, table)
            for table in (
                "quizzes",
                "quiz_questions",
                "quiz_attempts",
                "answers",
                "question_review_progress",
            )
        }


def test_favorites_are_idempotent_private_and_course_scoped(clients):
    owner, member, stranger, course = clients
    shared = approved(owner, course, "Shared?", [])
    own = draft(member, course, "Own?", [])

    first = add(member, course, shared)
    assert first.status_code == 200, first.text
    state = first.json()
    assert state["question_id"] == shared and state["favorite"] is True and state["favorited_at"]
    # Repeating the add keeps the first favorite and its time.
    assert add(member, course, shared).json() == state
    assert add(member, course, own).status_code == 200
    listed = favorites(member, course)
    assert [row["question_id"] for row in listed] == [own, shared]
    assert listed[0] == listed[0] | {"stem": "Own?", "type": "TRUE_FALSE", "available": True}
    assert [row["question_id"] for row in favorites(member, course, limit=1, offset=1)] == [shared]
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM question_favorites")) == 2

    # Private: nobody else sees them, and favoriting needs a question you may practice.
    assert stranger.get(f"/courses/{course}/favorites").status_code == 404
    assert add(stranger, course, shared).status_code == 404
    assert stranger.post(f"/courses/{course}/join").status_code == 200
    assert favorites(stranger, course) == []
    assert available(stranger, course, selection_mode="FAVORITES")["total"] == 0
    assert available(member, course, selection_mode="FAVORITES")["total"] == 2
    assert add(stranger, course, own).status_code == 404
    # A moderator sees the draft but cannot practice it, so cannot favorite it either.
    refused = add(owner, course, own)
    assert refused.status_code == 409 and "own drafts" in refused.json()["detail"]
    assert add(member, course, uuid4()).status_code == 404

    # Course-scoped: the question must belong to the course in the path.
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    other = create_course(owner, json={"name": "Other", "faculty_id": faculty}).json()["id"]
    assert add(owner, other, shared).status_code == 404
    assert remove(owner, other, shared).status_code == 404
    assert remove(member, other, shared).status_code == 404
    assert add(owner, course, shared).status_code == 200
    assert favorites(owner, other) == []
    assert [row["question_id"] for row in favorites(owner, course)] == [shared]

    # Removing is idempotent and leaves other students' favorites alone.
    removed = remove(member, course, shared)
    assert removed.status_code == 200, removed.text
    assert removed.json() == {"question_id": shared, "favorite": False, "favorited_at": None}
    assert remove(member, course, shared).json() == removed.json()
    assert [row["question_id"] for row in favorites(member, course)] == [own]
    assert [row["question_id"] for row in favorites(owner, course)] == [shared]


def test_favorites_mode_combines_with_unit_and_scope_filters(clients):
    owner, member, _, course = clients
    first = unit(owner, course, "Unit 1")
    second = unit(owner, course, "Unit 2")
    ids = {
        stem: draft(member, course, stem, units)
        for stem, units in [
            ("A?", [first]),
            ("B?", [second]),
            ("AB?", [first, second]),
            ("Loose?", []),
            ("Plain?", [first]),
        ]
    }
    # Without favorites there is nothing to select, and start keeps the usual 409.
    empty = available(member, course, selection_mode="FAVORITES")
    assert empty["total"] == empty["favorites_total"] == 0
    refused = start(member, course, 1, "FAVORITES")
    assert refused.status_code == 409 and "Only 0 eligible" in refused.json()["detail"]

    for stem in ["A?", "B?", "AB?", "Loose?"]:
        assert add(member, course, ids[stem]).status_code == 200
    whole = available(member, course, selection_mode="FAVORITES")
    assert whole["total"] == whole["favorites_total"] == 4
    standard = available(member, course)
    assert standard["total"] == 5 and standard["favorites_total"] == 4
    focused = available(member, course, selection_mode="FAVORITES", unit_ids=[first])
    assert focused["total"] == 2 and focused["by_unit"] == [{"unit_id": first, "count": 2}]
    midterm = scope(
        owner, course, academic_year="2025/26", kind="MIDTERM", name="MI", unit_ids=[first, second]
    )
    scoped = available(member, course, selection_mode="FAVORITES", exam_scope_id=midterm["id"])
    assert scoped["total"] == 3
    assert scoped["by_unit"] == [{"unit_id": first, "count": 2}, {"unit_id": second, "count": 2}]
    typed = available(member, course, selection_mode="FAVORITES", question_types=["SHORT_ANSWER"])
    assert typed["total"] == 0

    # Oldest favorite first; equal times fall back to question ID.
    now = datetime.now(UTC)
    favorited_at(member, [ids["Loose?"]], now - timedelta(days=3))
    favorited_at(member, [ids["A?"], ids["B?"], ids["AB?"]], now - timedelta(days=1))
    tied = sorted(["A?", "B?", "AB?"], key=lambda stem: ids[stem])
    refused = start(member, course, 5, "FAVORITES")
    assert refused.status_code == 409 and "Only 4 eligible" in refused.json()["detail"]
    session = started(member, course, 2, "FAVORITES", exam_scope_id=midterm["id"])
    assert stems(session) == tied[:2]
    assert session["exam_scope_id"] == midterm["id"] and session["focus_label"] == "MI 2025/26"
    assert all(question["favorite"] is True for question in session["questions"])

    # Sources in an unfinished session are excluded until it closes.
    assert available(member, course, selection_mode="FAVORITES")["total"] == 2
    assert stems(started(member, course, 2, "FAVORITES")) == ["Loose?", tied[2]]
    assert available(member, course, selection_mode="FAVORITES")["favorites_total"] == 0
    # Standard practice ignores favorites and active sessions as before.
    assert available(member, course)["total"] == 5


def test_ineligible_favorites_stay_saved_but_are_never_selected(clients):
    owner, member, _, course = clients
    shared = approved(owner, course, "Shared?", [])
    rework = draft(member, course, "Rework?", [])
    assert member.post(f"/questions/{rework}/submit").status_code == 200
    kept = draft(member, course, "Kept?", [])
    for question in (shared, rework, kept):
        assert add(member, course, question).status_code == 200
    reason = {"reason": "Needs rework"}
    assert review_question(owner, f"/questions/{rework}/reject", json=reason).status_code == 200
    assert review_question(owner, f"/questions/{shared}/archive").status_code == 200

    listed = favorites(member, course)
    assert [(row["stem"], row["available"]) for row in listed] == [
        ("Kept?", True),
        ("Rework?", False),
        ("Shared?", False),
    ]
    counts = available(member, course, selection_mode="FAVORITES")
    assert counts["total"] == counts["favorites_total"] == 1
    assert start(member, course, 2, "FAVORITES").status_code == 409
    assert stems(started(member, course, 1, "FAVORITES")) == ["Kept?"]
    # They cannot be added again: your own rejected draft says why, another's archive is hidden.
    assert add(member, course, rework).status_code == 409
    assert add(member, course, shared).status_code == 404
    # Removing still works.
    assert remove(member, course, shared).json()["favorite"] is False
    assert [row["stem"] for row in favorites(member, course)] == ["Kept?", "Rework?"]


def test_favorites_survive_edits_and_leave_history_unchanged(clients):
    owner, member, _, course = clients
    ids = {stem: approved(owner, course, stem, []) for stem in ("Q0?", "Q1?")}
    attempt = started(member, course, 2, "STANDARD")
    assert {q["source_question_id"] for q in attempt["questions"]} == set(ids.values())
    assert all(question["favorite"] is False for question in attempt["questions"])
    answer_and_submit(member, course, attempt, correct={"Q0?"})
    path = f"/courses/{course}/attempts/{attempt['id']}"
    submitted = member.get(path).json()
    before = history()

    target = submitted["questions"][0]
    assert add(member, course, target["source_question_id"]).status_code == 200
    favored = member.get(path).json()
    # Only the live flag changes; snapshots, answers, grades and progress stay as submitted.
    assert favored["questions"][0]["favorite"] is True
    assert favored["questions"][0] | {"favorite": False} == target
    assert favored["questions"][1] == submitted["questions"][1]
    assert history() == before
    assert remove(member, course, target["source_question_id"]).status_code == 200
    assert member.get(path).json() == submitted
    assert history() == before

    # Archiving the sources changes nothing in the attempt: the flag follows only the
    # student's own favorites.
    assert add(member, course, target["source_question_id"]).status_code == 200
    favored = member.get(path).json()
    for question in ids.values():
        assert review_question(owner, f"/questions/{question}/archive").status_code == 200
    assert member.get(path).json() == favored
    assert [question["favorite"] for question in favored["questions"]] == [True, False]
    assert history() == before
    # An archived favorite can still be removed, but not added again.
    assert remove(member, course, target["source_question_id"]).status_code == 200
    assert member.get(path).json() == submitted
    assert add(member, course, target["source_question_id"]).status_code == 404

    # Editing your own draft keeps its favorite and only changes the live bank text.
    own = draft(member, course, "Before edit?", [])
    assert add(member, course, own).status_code == 200
    edited = member.patch(f"/questions/{own}", json={"stem": "After edit?"})
    assert edited.status_code == 200, edited.text
    assert favorites(member, course)[0] | {"stem": "After edit?"} == favorites(member, course)[0]
    assert stems(started(member, course, 1, "FAVORITES")) == ["After edit?"]


def test_0023_roundtrip_drops_only_favorites(clients):
    _, member, _, course = clients
    question = draft(member, course, "Q?", [])
    assert add(member, course, question).status_code == 200
    attempt = started(member, course, 1, "STANDARD")
    path = f"/courses/{course}/attempts/{attempt['id']}"
    before = history()
    config = Config("alembic.ini")
    try:
        for _ in range(2):
            command.downgrade(config, "0022")
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0022"
                assert conn.scalar(text("SELECT to_regclass('question_favorites')")) is None
            assert history() == before
            command.upgrade(config, "head")
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0033"
            assert history() == before
            # No backfill: the favorite is gone, the session is not.
            assert favorites(member, course) == []
            assert member.get(path).json() == attempt | {
                "questions": [attempt["questions"][0] | {"favorite": False}]
            }
            assert add(member, course, question).status_code == 200
    finally:
        command.upgrade(config, "head")
    with engine.connect() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "compare_server_default": True,
                "include_object": lambda obj, name, type_, reflected, compare_to: (
                    type_ != "table" or name == "question_favorites"
                ),
            },
        )
        assert compare_metadata(context, Base.metadata) == []
