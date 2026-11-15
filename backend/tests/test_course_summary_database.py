"""Course list numbers, membership status, year of study and interface preferences (0028)."""

import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import delete, text
from test_exam_scopes_database import draft, scope, unit
from test_materials import clients as clients
from test_practice_database import bank as bank

from alembic import command
from app.database import SessionLocal, engine
from app.main import app
from app.models import Course
from app.models.faculty import Faculty
from app.models.faculty_moderator import FacultyModerator

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

DEFAULTS = {"palette": "dark", "custom": None, "font_scale": 1.0, "markers": "shapes"}
COLOURS = {"bg": "#1f1a24", "text": "#e8e0ee", "acc": "#e0a96d"}


def today():
    return datetime.now(UTC).date()


def day(offset: int) -> str:
    return (today() + timedelta(days=offset)).isoformat()


def mine(client, course):
    rows = [row for row in client.get("/courses").json() if row["id"] == course]
    assert len(rows) == 1
    return rows[0]


def faculty_of(client) -> str:
    return client.get("/faculties").json()[0]["id"]


def test_member_list_carries_status_question_count_and_nearest_exam(bank):
    owner, member, _, course, rows = bank
    row = mine(member, course)
    assert row["membership_status"] == "ACTIVE"
    assert row["approved_question_count"] == len(rows)
    assert row["next_exam"] is None and row["year_of_study"] is None

    # Only approved questions count, not drafts.
    first = unit(owner, course, "Logika")
    draft(owner, course, "A draft nobody practises", [first])
    assert mine(member, course)["approved_question_count"] == len(rows)

    base = {"academic_year": "2026/27", "unit_ids": [first]}
    # Not exams, or over: all ignored.
    scope(owner, course, **base, kind="LAB", name="Lab", starts_on=day(1))
    scope(owner, course, **base, kind="QUIZ", name="Blic", starts_on=day(1))
    scope(owner, course, **base, kind="FINAL", name="Prošli rok", starts_on=day(-30))
    scope(owner, course, **base, kind="FULL_EXAM", name="Bez datuma")
    scope(owner, course, **base, kind="MIDTERM", name="Kasniji", starts_on=day(40))
    assert mine(member, course)["next_exam"]["name"] == "Kasniji"

    scope(owner, course, **base, kind="FINAL", name="Bliži", starts_on=day(10))
    nearest = mine(member, course)["next_exam"]
    assert (nearest["name"], nearest["kind"], nearest["starts_on"]) == ("Bliži", "FINAL", day(10))
    assert nearest["ends_on"] is None

    # An exam that began yesterday and ends tomorrow is still the next one.
    scope(owner, course, **base, kind="MIDTERM", name="U tijeku", starts_on=day(-1), ends_on=day(1))
    assert mine(member, course)["next_exam"]["name"] == "U tijeku"
    assert owner.get("/courses").json()[0]["membership_status"] == "ACTIVE"


def test_status_changes_keep_access_and_enrolling_again_unhides(bank):
    owner, member, stranger, course, _ = bank
    path = f"/courses/{course}/membership"

    done = member.patch(path, json={"status": "DONE"})
    assert done.status_code == 200 and done.json()["status"] == "DONE"
    assert mine(member, course)["membership_status"] == "DONE"

    hidden = member.patch(path, json={"status": "HIDDEN"})
    assert hidden.status_code == 200 and hidden.json()["role"] == "MEMBER"
    assert mine(member, course)["membership_status"] == "HIDDEN"
    # Hiding changes the list, not what the student may open or practise.
    assert member.get(f"/courses/{course}").status_code == 200
    assert member.get(f"/courses/{course}/questions").status_code == 200
    assert member.get(path).json()["status"] == "HIDDEN"

    # Enrolling again brings a hidden course back, and leaves a finished one finished.
    assert member.post(f"/courses/{course}/join").json()["status"] == "ACTIVE"
    assert mine(member, course)["membership_status"] == "ACTIVE"
    member.patch(path, json={"status": "DONE"})
    assert member.post(f"/courses/{course}/join").json()["status"] == "DONE"

    # The owner keeps the role whatever the status.
    assert owner.patch(path, json={"status": "HIDDEN"}).json()["role"] == "OWNER"

    assert stranger.patch(path, json={"status": "DONE"}).status_code == 404
    assert member.patch(path, json={"status": "GONE"}).status_code == 422
    assert member.patch(path, json={"status": "DONE", "role": "OWNER"}).status_code == 422
    assert member.patch(path, json={}).status_code == 422


def test_a_joined_student_starts_active_and_the_catalog_has_counts_and_moderators(bank):
    owner, member, stranger, course, rows = bank
    faculty = faculty_of(owner)

    assert stranger.post(f"/courses/{course}/join").json()["status"] == "ACTIVE"

    catalog = {row["id"]: row for row in member.get(f"/faculties/{faculty}/courses").json()}
    entry = catalog[course]
    assert entry["approved_question_count"] == len(rows)
    assert entry["has_moderators"] is True and entry["year_of_study"] is None
    assert "membership_status" not in entry

    # A faculty without any moderator says so, and a course without questions counts zero.
    token = uuid4().hex[:8]
    with SessionLocal() as db:
        owner_id = db.get(Course, UUID(course)).created_by_user_id
        bare = Faculty(name=f"Bez moderatora {token}", slug=f"bez-moderatora-{token}")
        db.add(bare)
        db.flush()
        db.add(Course(faculty_id=bare.id, name="Prazan kolegij", created_by_user_id=owner_id))
        db.commit()
        bare_id = bare.id
    try:
        listed = member.get(f"/faculties/{bare_id}/courses").json()
        summary = [(r["name"], r["approved_question_count"], r["has_moderators"]) for r in listed]
        assert summary == [("Prazan kolegij", 0, False)]
    finally:
        with SessionLocal() as db:
            db.execute(delete(Course).where(Course.faculty_id == bare_id))
            db.execute(delete(Faculty).where(Faculty.id == bare_id))
            db.commit()


def test_a_faculty_moderator_sets_the_year_of_study(bank):
    owner, member, stranger, course, _ = bank
    faculty = faculty_of(owner)
    path = f"/courses/{course}"

    set_year = owner.patch(path, json={"year_of_study": 2})
    assert set_year.status_code == 200 and set_year.json()["year_of_study"] == 2
    assert mine(member, course)["year_of_study"] == 2
    row = next(r for r in member.get(f"/faculties/{faculty}/courses").json() if r["id"] == course)
    assert row["year_of_study"] == 2

    # Students, including one who joined, cannot change it; the range is 1 to 6.
    assert member.patch(path, json={"year_of_study": 3}).status_code == 403
    assert stranger.patch(path, json={"year_of_study": 3}).status_code == 403
    for year in (0, 7):
        assert owner.patch(path, json={"year_of_study": year}).status_code == 422
    assert owner.get(path).json()["year_of_study"] == 2

    # A moderator of the faculty may set it without owning or joining the course, but still
    # cannot edit the rest of it.
    stranger_id = stranger.get("/auth/me").json()["id"]
    with SessionLocal() as db:
        db.add(FacultyModerator(faculty_id=UUID(faculty), user_id=UUID(stranger_id)))
        db.commit()
    assert stranger.patch(path, json={"year_of_study": 4}).json()["year_of_study"] == 4
    assert stranger.patch(path, json={"name": "Hijacked"}).status_code == 404
    assert stranger.patch(path, json={"year_of_study": 5, "name": "Hijacked"}).status_code == 404
    assert owner.get(path).json()["name"] == "Materials"

    assert owner.patch(path, json={"year_of_study": None}).json()["year_of_study"] is None

    created = owner.post(
        "/courses", json={"name": "Nova", "faculty_id": faculty, "year_of_study": 1}
    )
    assert created.status_code == 201 and created.json()["year_of_study"] == 1
    bad = owner.post("/courses", json={"name": "Loša", "faculty_id": faculty, "year_of_study": 9})
    assert bad.status_code == 422


def test_preferences_default_roundtrip_validation_and_isolation(clients):
    owner, member, _, _ = clients
    assert owner.get("/users/me/preferences").json() == DEFAULTS

    custom = {"palette": "custom", "custom": COLOURS, "font_scale": 1.15, "markers": "letters"}
    saved = owner.put("/users/me/preferences", json=custom)
    assert saved.status_code == 200 and saved.json() == custom
    assert owner.get("/users/me/preferences").json() == custom
    # Another user keeps the defaults.
    assert member.get("/users/me/preferences").json() == DEFAULTS

    # Saving replaces the whole document; the custom colours stay for switching back.
    back = {"palette": "night", "custom": COLOURS, "font_scale": 1, "markers": "shapes"}
    assert owner.put("/users/me/preferences", json=back).json()["font_scale"] == 1.0
    assert owner.get("/users/me/preferences").json()["custom"] == COLOURS

    invalid = [
        {"palette": "custom"},
        {"palette": "custom", "custom": {**COLOURS, "bg": "#12345"}},
        {"palette": "custom", "custom": {**COLOURS, "bg": "red"}},
        {"palette": "custom", "custom": {"bg": "#000000", "text": "#ffffff"}},
        {"palette": "pastel"},
        {"font_scale": 1.1},
        {"markers": "emoji"},
        {"theme": "dark"},
    ]
    for body in invalid:
        assert owner.put("/users/me/preferences", json=body).status_code == 422, body
    assert owner.get("/users/me/preferences").json()["palette"] == "night"

    with TestClient(app) as anonymous:
        assert anonymous.get("/users/me/preferences").status_code == 401
        assert anonymous.put("/users/me/preferences", json={}).status_code == 401


def test_0028_roundtrip_drops_the_new_columns_and_keeps_courses_and_memberships(bank):
    owner, member, _, course, _ = bank
    owner.patch(f"/courses/{course}", json={"year_of_study": 3})
    member.patch(f"/courses/{course}/membership", json={"status": "HIDDEN"})
    owner.put("/users/me/preferences", json={"palette": "light"})

    def columns(table: str) -> set[str]:
        with engine.connect() as conn:
            return set(
                conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema = current_schema() AND table_name = :table"
                    ),
                    {"table": table},
                ).scalars()
            )

    config = Config("alembic.ini")
    try:
        for _ in range(2):
            command.downgrade(config, "0027")
            assert "year_of_study" not in columns("courses")
            assert "status" not in columns("course_memberships")
            assert not columns("user_preferences")
            # Plain SQL: the models already know the columns this downgrade removed.
            with engine.connect() as conn:
                params = {"id": course}
                assert conn.scalar(text("SELECT count(*) FROM courses WHERE id = :id"), params) == 1
                assert (
                    conn.scalar(
                        text("SELECT count(*) FROM course_memberships WHERE course_id = :id"),
                        params,
                    )
                    == 2
                )
            command.upgrade(config, "head")
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0032"
            # Years, statuses and preferences are not restored: everyone starts at the defaults.
            assert mine(member, course)["membership_status"] == "ACTIVE"
            assert mine(member, course)["year_of_study"] is None
            assert owner.get("/users/me/preferences").json() == DEFAULTS
            owner.patch(f"/courses/{course}", json={"year_of_study": 3})
            owner.put("/users/me/preferences", json={"palette": "light"})
    finally:
        command.upgrade(config, "head")
