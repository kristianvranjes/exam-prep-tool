import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from test_exam_scopes_database import scope, unit
from test_materials import clients as clients
from test_practice_database import bank as bank

from app.database import SessionLocal
from app.main import app
from app.models import Course, CourseMembership
from app.models.user_question_progress import UserQuestionProgress
from app.services.course_summaries import zagreb_today

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

CUSTOM = {"background": "#101820", "text": "#EEEEEE", "accent": "#A1C349"}
DEFAULT_BODY = {"palette": "dark", "font_scale_percent": 100, "answer_markers": "letters"}


def user_id(client):
    return UUID(client.get("/auth/me").json()["id"])


def course_row(items, course_id):
    return next(item for item in items if item["id"] == course_id)


def record(user, question, result, stage=2):
    now = datetime.now(UTC)
    with SessionLocal() as db:
        db.add(
            UserQuestionProgress(
                user_id=user,
                question_id=UUID(question),
                review_stage=stage,
                resolved_review_count=1,
                correct_review_count=1 if result == "CORRECT" else 0,
                incorrect_review_count=0 if result == "CORRECT" else 1,
                last_result=result,
                last_reviewed_at=now,
                due_at=now + timedelta(days=1),
                scheduling_version="leitner-v1",
            )
        )
        db.commit()


def test_database_constraints(clients):
    _, member, _, _ = clients
    with SessionLocal() as db:
        for sql in (
            "UPDATE courses SET year_of_study = 0",
            "UPDATE courses SET year_of_study = 6",
            "UPDATE course_memberships SET status = 'LEFT'",
        ):
            with pytest.raises(IntegrityError):
                db.execute(text(sql))
            db.rollback()
        for palette, colors in (
            ("neon", (None, None, None)),
            ("custom", (None, None, None)),
            ("dark", ("#fff", "#000000", "#000000")),
            ("dark", ("#101820", None, None)),
        ):
            with pytest.raises(IntegrityError):
                db.execute(
                    text(
                        "INSERT INTO user_preferences (user_id, palette, custom_background, "
                        "custom_text, custom_accent) VALUES (:u, :p, :b, :t, :a)"
                    ),
                    {
                        "u": user_id(member),
                        "p": palette,
                        "b": colors[0],
                        "t": colors[1],
                        "a": colors[2],
                    },
                )
            db.rollback()
        with pytest.raises(IntegrityError):
            db.execute(
                text("INSERT INTO user_preferences (user_id, font_scale_percent) VALUES (:u, 105)"),
                {"u": user_id(member)},
            )
        db.rollback()
        assert db.scalar(select(func.count()).select_from(Course)) == 1


def test_year_of_study_and_catalog_counts(bank):
    owner, member, _, course, rows = bank
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    assert owner.get(f"/courses/{course}").json()["year_of_study"] is None
    for bad in (0, 6, "two"):
        assert owner.patch(f"/courses/{course}", json={"year_of_study": bad}).status_code == 422
    assert member.patch(f"/courses/{course}", json={"year_of_study": 2}).status_code == 403
    changed = owner.patch(f"/courses/{course}", json={"year_of_study": 2})
    assert changed.status_code == 200 and changed.json()["year_of_study"] == 2
    # A partial update keeps the year; an explicit null clears it.
    assert owner.patch(f"/courses/{course}", json={"name": "Renamed"}).json()["year_of_study"] == 2
    created = owner.post(
        "/courses", json={"name": "Second year", "faculty_id": faculty, "year_of_study": 5}
    )
    assert created.status_code == 201 and created.json()["year_of_study"] == 5
    too_high = {"name": "No", "faculty_id": faculty, "year_of_study": 7}
    assert owner.post("/courses", json=too_high).status_code == 422

    catalog = member.get(f"/faculties/{faculty}/courses").json()
    first = course_row(catalog, course)
    assert first["year_of_study"] == 2 and first["approved_question_count"] == len(rows)
    assert course_row(catalog, created.json()["id"])["approved_question_count"] == 0
    cleared = owner.patch(f"/courses/{course}", json={"year_of_study": None})
    assert cleared.json()["year_of_study"] is None


def test_course_list_summary(bank):
    owner, member, _, course, rows = bank
    only = member.get("/courses").json()
    assert [item["id"] for item in only] == [course]
    item = only[0]
    assert item["role"] == "MEMBER" and item["status"] == "ACTIVE"
    assert item["approved_question_count"] == len(rows)
    gradable = [row for row in rows if row["type"] != "SHORT_ANSWER"]
    assert gradable and item["mastery_percent"] == 0 and item["next_exam"] is None
    assert owner.get("/courses").json()[0]["role"] == "OWNER"

    # Mastery follows the readiness-v1 retention proxy, rounded half up.
    me = user_id(member)
    record(me, gradable[0]["id"], "CORRECT")
    expected = (200 * 1 + len(gradable)) // (2 * len(gradable))
    assert member.get("/courses").json()[0]["mastery_percent"] == expected
    for row in gradable[1:]:
        record(me, row["id"], "CORRECT")
    assert member.get("/courses").json()[0]["mastery_percent"] == 100
    with SessionLocal() as db:
        db.execute(
            text(
                "UPDATE question_review_progress SET last_result = 'INCORRECT' "
                "WHERE question_id = :q"
            ),
            {"q": gradable[0]["id"]},
        )
        db.commit()
    retained = len(gradable) - 1
    assert member.get("/courses").json()[0]["mastery_percent"] == (
        (200 * retained + len(gradable)) // (2 * len(gradable))
    )
    # Another member's answers never leak into this list.
    assert owner.get("/courses").json()[0]["mastery_percent"] == 0


def test_next_exam_is_the_dated_cycle_in_progress_or_coming(clients):
    owner, member, _, course = clients
    first = unit(owner, course, "Logika")
    today = zagreb_today()
    body = {"academic_year": "2026/27", "unit_ids": [first]}

    def make(name, kind, starts, ends=None):
        dates = {"starts_on": str(starts) if starts else None}
        dates["ends_on"] = str(ends) if ends else None
        return scope(owner, course, **body, kind=kind, name=name, **dates)

    make("Past midterm", "MIDTERM", today - timedelta(days=30), today - timedelta(days=20))
    make("Undated lab", "LAB", None)
    make("Final", "FINAL", today + timedelta(days=40))
    assert member.get("/courses").json()[0]["next_exam"]["name"] == "Final"
    soon = make("Midterm", "MIDTERM", today + timedelta(days=10), today + timedelta(days=12))
    exam = member.get("/courses").json()[0]["next_exam"]
    assert exam["scope_id"] == soon["id"] and exam["kind"] == "MIDTERM"
    assert exam["starts_on"] == str(today + timedelta(days=10))
    assert exam["ends_on"] == str(today + timedelta(days=12))
    # A cycle that is under way still counts until its last day.
    running = make("Running", "QUIZ", today - timedelta(days=1), today + timedelta(days=1))
    assert member.get("/courses").json()[0]["next_exam"]["scope_id"] == running["id"]


def test_finish_leave_and_rejoin(bank):
    owner, member, stranger, course, rows = bank
    path = f"/courses/{course}/membership"
    assert member.get(path).json()["status"] == "ACTIVE"
    for bad in ({"status": "LEFT"}, {"status": "FINISHED", "role": "OWNER"}, {}):
        assert member.patch(path, json=bad).status_code == 422
    assert stranger.patch(path, json={"status": "FINISHED"}).status_code == 404
    assert stranger.delete(path).status_code == 404

    done = member.patch(path, json={"status": "FINISHED"})
    assert done.status_code == 200 and done.json()["status"] == "FINISHED"
    assert done.json()["role"] == "MEMBER"
    # Finished only moves the course between lists: access and practice are unchanged.
    assert member.get(f"/courses/{course}").status_code == 200
    assert member.get("/courses").json()[0]["status"] == "FINISHED"
    assert member.patch(path, json={"status": "FINISHED"}).json()["status"] == "FINISHED"
    assert member.patch(path, json={"status": "ACTIVE"}).json()["status"] == "ACTIVE"

    gradable = next(row for row in rows if row["type"] != "SHORT_ANSWER")
    record(user_id(member), gradable["id"], "CORRECT")
    assert owner.delete(path).status_code == 409
    assert owner.get("/courses").json()[0]["role"] == "OWNER"

    assert member.delete(path).status_code == 204
    assert member.delete(path).status_code == 404
    assert member.get(f"/courses/{course}").status_code == 404
    assert member.get("/courses").json() == []
    assert member.get(f"/courses/{course}/questions").status_code == 404
    # The owner's course and the leaver's history are untouched.
    assert owner.get(f"/courses/{course}").status_code == 200
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(UserQuestionProgress)) == 1
        members = select(func.count()).where(CourseMembership.course_id == UUID(course))
        assert db.scalar(members) == 1

    rejoined = member.post(f"/courses/{course}/join")
    assert rejoined.status_code == 200 and rejoined.json()["status"] == "ACTIVE"
    assert member.get("/courses").json()[0]["mastery_percent"] > 0


def test_preferences_defaults_replace_and_isolation(clients):
    owner, member, _, _ = clients
    defaults = DEFAULT_BODY | {"custom_colors": None, "updated_at": None}
    assert member.get("/auth/me/preferences").json() == defaults

    body = {
        "palette": "custom",
        "font_scale_percent": 115,
        "answer_markers": "shapes",
        "custom_colors": CUSTOM,
    }
    saved = member.put("/auth/me/preferences", json=body)
    assert saved.status_code == 200, saved.text
    # Colours are stored lower-case, and saving again replaces the whole document.
    expected = body | {"custom_colors": {key: value.lower() for key, value in CUSTOM.items()}}
    assert {k: v for k, v in saved.json().items() if k != "updated_at"} == expected
    first_saved = saved.json()["updated_at"]
    assert first_saved is not None
    assert member.get("/auth/me/preferences").json()["updated_at"] == first_saved

    light = {"palette": "light", "font_scale_percent": 90, "answer_markers": "letters"}
    switched = member.put("/auth/me/preferences", json=light)
    assert switched.status_code == 200
    assert switched.json()["custom_colors"] is None and switched.json()["palette"] == "light"
    assert switched.json()["updated_at"] >= first_saved
    assert member.put("/auth/me/preferences", json=light).status_code == 200
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(text("user_preferences"))) == 1

    # Preferences belong to one user.
    assert owner.get("/auth/me/preferences").json() == defaults


@pytest.mark.parametrize(
    "change",
    [
        {"palette": "neon"},
        {"palette": "custom"},
        {"font_scale_percent": 105},
        {"font_scale_percent": "100"},
        {"answer_markers": "emoji"},
        {"custom_colors": {"background": "red", "text": "#000000", "accent": "#000000"}},
        {"custom_colors": {"background": "#101820", "text": "#000000"}},
        {"custom_colors": {"background": "#10182", "text": "#000000", "accent": "#000000"}},
        {"language": "en"},
    ],
)
def test_invalid_preferences_are_rejected(clients, change):
    _, member, _, _ = clients
    assert member.put("/auth/me/preferences", json=DEFAULT_BODY | change).status_code == 422
    assert member.get("/auth/me/preferences").json()["updated_at"] is None


def test_preferences_and_membership_need_a_session(clients):
    _, _, _, course = clients
    with TestClient(app) as anonymous:
        assert anonymous.get("/auth/me/preferences").status_code == 401
        assert anonymous.put("/auth/me/preferences", json=DEFAULT_BODY).status_code == 401
        assert anonymous.delete(f"/courses/{course}/membership").status_code == 401
        finished = {"status": "FINISHED"}
        assert anonymous.patch(f"/courses/{course}/membership", json=finished).status_code == 401
