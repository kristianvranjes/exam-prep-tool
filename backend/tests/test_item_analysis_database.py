import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from community_helpers import create_course, provision
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_practice_database import bank as bank
from test_practice_database import clients as clients

from app.database import SessionLocal
from app.main import app
from app.models import User
from app.models.question import QuestionVersion
from app.models.quiz import Answer, Quiz, QuizAttempt, QuizQuestion
from app.services.item_statistics import MIN_SAMPLE_SIZE

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

ITEM_KEYS = {
    "question_id",
    "type",
    "stem",
    "sample_size",
    "earlier_version_sample",
    "enough_data",
    "difficulty",
    "upper_correct",
    "lower_correct",
    "discrimination",
    "ranked_size",
    "group_size",
    "flags",
    "options",
}


def by_type(rows, kind):
    return next(row["id"] for row in rows if row["type"] == kind)


def mcq(position):
    return {"type": "MULTIPLE_CHOICE", "option_position": position}


def tf(value):
    return {"type": "TRUE_FALSE", "value": value}


def take(course, items, student=None, status="SUBMITTED", checked=False, earlier=False):
    """Store one attempt directly: items are (question id, payload, grade) triples.

    Mirrors what practice stores; `earlier` answers the version before the current one.
    """
    with SessionLocal() as db:
        if student is None:
            user = User(
                email=f"student-{uuid4().hex}@example.com",
                password_hash="unused",
                display_name="Student",
            )
            db.add(user)
            db.flush()
            student = user.id
        now = datetime.now(UTC)
        quiz = Quiz(
            course_id=UUID(course),
            user_id=student,
            feedback_mode="IMMEDIATE" if checked else "END",
        )
        db.add(quiz)
        db.flush()
        attempt = QuizAttempt(
            quiz_id=quiz.id,
            status=status,
            submitted_at=now if status == "SUBMITTED" else None,
            abandoned_at=now if status == "ABANDONED" else None,
        )
        db.add(attempt)
        db.flush()
        for position, (question_id, payload, grade) in enumerate(items):
            version = db.scalars(
                select(QuestionVersion)
                .where(QuestionVersion.question_id == UUID(question_id))
                .order_by(QuestionVersion.version_number.desc())
            ).first()
            assert version is not None
            row = QuizQuestion(
                quiz_id=quiz.id,
                position=position,
                source_question_id=UUID(question_id),
                source_version=version.version_number - earlier,
                snapshot=version.snapshot,
            )
            db.add(row)
            db.flush()
            method = (
                "DETERMINISTIC"
                if grade != "PENDING"
                else "PENDING_SEMANTIC"
                if status == "SUBMITTED"
                else None
            )
            db.add(
                Answer(
                    attempt_id=attempt.id,
                    quiz_question_id=row.id,
                    payload=payload,
                    grading_status=grade,
                    grading_method=method,
                    grading_version="deterministic-v1" if method else None,
                    checked_at=now if checked else None,
                )
            )
        db.commit()
        return student


def practise(member, course, payload):
    """A real one-question practice session through the API."""
    path = f"/courses/{course}/attempts"
    attempt = member.post(path, json={"count": 1, "question_types": [payload["type"]]}).json()
    question = attempt["questions"][0]["id"]
    saved = member.patch(f"{path}/{attempt['id']}/answers/{question}", json=payload)
    assert saved.status_code == 200, saved.text
    assert member.post(f"{path}/{attempt['id']}/submit").status_code == 200


def test_course_managers_only_and_no_student_identities(bank):
    owner, member, stranger, course, rows = bank
    path = f"/courses/{course}/item-analysis"
    question = by_type(rows, "MULTIPLE_CHOICE")
    students = [take(course, [(question, mcq(0), "CORRECT")]) for _ in range(MIN_SAMPLE_SIZE)]
    listed = owner.get(path)
    assert listed.status_code == 200, listed.text
    detail = owner.get(f"{path}/{question}")
    assert detail.status_code == 200, detail.text
    assert member.get(path).status_code == 403
    assert member.get(f"{path}/{question}").status_code == 403
    assert stranger.get(path).status_code == 404
    assert stranger.get(f"{path}/{question}").status_code == 404
    with TestClient(app) as anonymous:
        assert anonymous.get(path).status_code == 401

    # Faculty moderators manage without enrolling, as with past papers.
    with TestClient(app) as moderator:
        registered = moderator.post(
            "/auth/register",
            json={
                "email": "analysis-moderator@example.com",
                "password": "correct horse",
                "display_name": "Moderator",
            },
        )
        assert registered.status_code == 201
        assert moderator.get(path).status_code == 404
        provision(moderator, owner.get(f"/courses/{course}").json()["faculty_id"])
        assert moderator.get(path).json() == listed.json()
        assert moderator.get(f"{path}/{question}").json() == detail.json()

    # Aggregates only: no student, attempt or answer identifiers anywhere.
    assert set(detail.json()) == ITEM_KEYS
    assert set(detail.json()["options"][0]) == {
        "position",
        "text",
        "is_key",
        "count",
        "share",
        "upper_share",
        "lower_share",
        "flag",
    }
    for student in students:
        assert str(student) not in listed.text + detail.text

    # Only approved questions of this course are analysed.
    draft = owner.post(
        f"/courses/{course}/questions",
        json={"type": "TRUE_FALSE", "stem": "Draft only", "correct_answer": True},
    ).json()["id"]
    assert owner.get(f"{path}/{draft}").status_code == 404
    assert owner.get(f"{path}/{uuid4()}").status_code == 404
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    other = create_course(owner, json={"name": "Other", "faculty_id": faculty}).json()["id"]
    assert owner.get(f"/courses/{other}/item-analysis/{question}").status_code == 404
    assert owner.get(f"/courses/{other}/item-analysis").json()["items"] == []


def test_threshold_and_which_answers_count(bank):
    owner, member, _, course, rows = bank
    question = by_type(rows, "MULTIPLE_CHOICE")
    path = f"/courses/{course}/item-analysis/{question}"
    empty = owner.get(path).json()
    assert (empty["sample_size"], empty["enough_data"], empty["options"]) == (0, False, [])

    students = [
        take(course, [(question, mcq(i % 2), "INCORRECT" if i % 2 else "CORRECT")])
        for i in range(MIN_SAMPLE_SIZE - 2)
    ]
    # A later repeat, unchecked answers and answers to an earlier version do not count.
    take(course, [(question, mcq(1), "INCORRECT")], student=students[0])
    take(course, [(question, mcq(0), "PENDING")], status="ACTIVE")
    take(course, [(question, mcq(0), "PENDING")], status="ABANDONED")
    take(course, [(question, mcq(0), "CORRECT")], earlier=True)
    practise(member, course, mcq(0))
    below = owner.get(path).json()
    assert (below["sample_size"], below["earlier_version_sample"]) == (MIN_SAMPLE_SIZE - 1, 1)
    assert below["enough_data"] is False
    assert (below["difficulty"], below["discrimination"]) == (None, None)
    assert (below["flags"], below["options"]) == ([], [])

    # A checked immediate-feedback answer is final even if the session was abandoned.
    take(course, [(question, mcq(0), "CORRECT")], status="ABANDONED", checked=True)
    reported = owner.get(path).json()
    assert (reported["sample_size"], reported["enough_data"]) == (MIN_SAMPLE_SIZE, True)
    assert reported["difficulty"] == pytest.approx(16 / 30)
    assert [(o["position"], o["text"], o["is_key"], o["count"]) for o in reported["options"]] == [
        (0, "A rectangular array of entries", True, 16),
        (1, "A single operation", False, 14),
    ]
    # Nobody answered another question, so nobody can be ranked into groups.
    assert (reported["ranked_size"], reported["group_size"]) == (0, None)


def test_list_puts_flagged_questions_first_and_paginates(bank):
    owner, _, _, course, rows = bank
    choice, boolean, short = (
        by_type(rows, kind) for kind in ("MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER")
    )
    for i in range(35):
        items = [
            (boolean, tf(i % 3 != 0), "CORRECT" if i % 3 else "INCORRECT"),
            (short, {"type": "SHORT_ANSWER", "text": "Same rows and columns"}, "PENDING"),
        ]
        if i < 30:
            items.append((choice, mcq(0), "CORRECT"))
        take(course, items)
    path = f"/courses/{course}/item-analysis"
    listed = owner.get(path).json()
    # Pending short answers are never graded, so that question is not listed.
    assert {key: listed[key] for key in ("min_sample_size", "total", "analysed", "flagged")} == {
        "min_sample_size": MIN_SAMPLE_SIZE,
        "total": 2,
        "analysed": 2,
        "flagged": 1,
    }
    assert listed["analysis_version"] == "item-analysis-v1"
    # The easy question comes first despite its smaller sample.
    assert [
        (item["question_id"], item["sample_size"], item["flags"]) for item in listed["items"]
    ] == [
        (choice, 30, ["TOO_EASY"]),
        (boolean, 35, []),
    ]
    true_false = listed["items"][1]
    assert true_false["difficulty"] == pytest.approx(23 / 35)
    assert [(o["text"], o["is_key"], o["count"]) for o in true_false["options"]] == [
        ("True", True, 23),
        ("False", False, 12),
    ]
    # Every ranked student has the same rest score here, so the groups are equal.
    assert (true_false["ranked_size"], true_false["discrimination"]) == (30, 0)
    page = owner.get(path, params={"limit": 1, "offset": 1}).json()
    assert [item["question_id"] for item in page["items"]] == [boolean]
    assert page["total"] == 2
    for params in ({"limit": 0}, {"limit": 51}, {"offset": -1}, {"offset": 10001}):
        assert owner.get(path, params=params).status_code == 422
