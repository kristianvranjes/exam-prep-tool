"""Mastery, the caller's role and the Zagreb date in the course list (no migration)."""

import os
from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from test_exam_scopes_database import scope, unit
from test_materials import clients as clients
from test_practice_database import bank as bank

from app.database import SessionLocal
from app.models import User
from app.models.user_question_progress import UserQuestionProgress
from app.services.course_summaries import (
    list_member_courses,
    next_exams,
    percent_half_up,
    zagreb_today,
)

requires_db = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


@pytest.mark.parametrize(
    ("part", "whole", "expected"),
    [(0, 5, 0), (1, 8, 13), (1, 3, 33), (2, 3, 67), (1, 2, 50), (7, 8, 88), (5, 5, 100)],
)
def test_percent_rounds_half_up(part, whole, expected):
    assert percent_half_up(part, whole) == expected


def test_today_is_the_date_in_zagreb():
    assert zagreb_today() == datetime.now(ZoneInfo("Europe/Zagreb")).date()


def mine(client, course):
    rows = [row for row in client.get("/courses").json() if row["id"] == course]
    assert len(rows) == 1
    return rows[0]


def add_progress(db, user_id: UUID, question_id: str, *, result: str, stage: int, due_at: datetime):
    correct = result == "CORRECT"
    db.add(
        UserQuestionProgress(
            user_id=user_id,
            question_id=UUID(question_id),
            review_stage=stage,
            resolved_review_count=1,
            correct_review_count=int(correct),
            incorrect_review_count=int(not correct),
            last_result=result,
            last_reviewed_at=datetime.now(UTC),
            due_at=due_at,
            scheduling_version="leitner-v1",
        )
    )


@requires_db
def test_mastery_counts_the_retained_gradable_questions_of_the_caller(bank):
    owner, member, _, course, rows = bank
    gradable = [row for row in rows if row["type"] != "SHORT_ANSWER"]
    ungraded = [row for row in rows if row["type"] == "SHORT_ANSWER"]
    assert len(gradable) >= 2
    member_id = UUID(member.get("/auth/me").json()["id"])
    # Nothing answered yet: a started-from-zero course reads 0, not missing.
    assert mine(member, course)["mastery_percent"] == 0

    now = datetime.now(UTC)
    with SessionLocal() as db:
        add_progress(
            db,
            member_id,
            gradable[0]["id"],
            result="CORRECT",
            stage=1,
            due_at=now + timedelta(hours=1),
        )
        # Correct, but overdue by more than its own 10-minute interval: no longer retained.
        add_progress(
            db,
            member_id,
            gradable[1]["id"],
            result="CORRECT",
            stage=0,
            due_at=now - timedelta(days=1),
        )
        for row in ungraded:
            add_progress(
                db, member_id, row["id"], result="CORRECT", stage=1, due_at=now + timedelta(hours=1)
            )
        db.commit()
    assert mine(member, course)["mastery_percent"] == percent_half_up(1, len(gradable))
    # Someone else's answers never count: the owner has none.
    assert mine(owner, course)["mastery_percent"] == 0


@requires_db
def test_a_course_without_gradable_approved_questions_has_no_mastery(bank):
    owner, _, _, course, _ = bank
    faculty = owner.get("/faculties").json()[0]["id"]
    created = owner.post("/courses", json={"name": "Prazan kolegij", "faculty_id": faculty})
    assert created.status_code == 201, created.text
    empty = mine(owner, created.json()["id"])
    assert empty["mastery_percent"] is None and empty["approved_question_count"] == 0
    assert isinstance(mine(owner, course)["mastery_percent"], int)


@requires_db
def test_the_list_says_whether_the_caller_owns_the_course(bank):
    owner, member, _, course, _ = bank
    assert mine(owner, course)["role"] == "OWNER"
    assert mine(member, course)["role"] == "MEMBER"


@requires_db
def test_the_next_exam_counts_up_to_its_last_day_of_the_given_date(bank):
    owner, member, _, course, _ = bank
    first = unit(owner, course, "Logika")
    exam_day = date(2030, 5, 6)
    scope(
        owner,
        course,
        academic_year="2029/30",
        unit_ids=[first],
        kind="FINAL",
        name="Završni",
        starts_on=exam_day.isoformat(),
    )
    course_id = UUID(course)
    with SessionLocal() as db:
        assert next_exams(db, [course_id], exam_day)[course_id].name == "Završni"
        assert next_exams(db, [course_id], exam_day + timedelta(days=1)) == {}
        user = db.get(User, UUID(member.get("/auth/me").json()["id"]))
        assert user is not None
        assert list_member_courses(db, user, today=exam_day)[0].next_exam is not None
        assert (
            list_member_courses(db, user, today=exam_day + timedelta(days=1))[0].next_exam is None
        )
