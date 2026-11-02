import os
from uuid import uuid4

import pytest
from community_helpers import create_course
from sqlalchemy import text
from test_exam_scopes_database import draft, scope, unit
from test_materials import clients as clients
from test_practice_database import bank as bank

from app.database import engine

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

TYPES = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"]


def available(client, course, **params):
    response = client.get(f"/courses/{course}/practice-availability", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def by_type(body):
    return {row["type"]: row["count"] for row in body["by_type"]}


def start(client, course, count, **focus):
    body = {"count": count, "question_types": TYPES, "selection_mode": "STANDARD"} | focus
    return client.post(f"/courses/{course}/attempts", json=body)


def test_availability_matches_session_start(clients):
    owner, member, stranger, course = clients
    first = unit(owner, course, "Unit 1")
    second = unit(owner, course, "Unit 2")
    empty_unit = unit(owner, course, "Unit 3")
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    other = create_course(owner, json={"name": "Other", "faculty_id": faculty}).json()["id"]
    foreign = unit(owner, other, "Foreign")
    draft(member, course, "One?", [first])
    draft(member, course, "Two?", [second])
    draft(member, course, "One and two?", [first, second])
    draft(member, course, "Loose?", [])
    # Another student's drafts are never available to this student.
    draft(owner, course, "Owner draft?", [first])

    whole = available(member, course)
    assert whole["course_total"] == 4 and whole["total"] == 4
    assert by_type(whole) == {
        "MULTIPLE_CHOICE": 0,
        "TRUE_FALSE": 4,
        "SHORT_ANSWER": 0,
        "NUMERIC": 0,
        "MULTIPLE_SELECT": 0,
    }
    assert whole["by_unit"] == []
    assert available(owner, course)["total"] == 1
    typed = available(member, course, question_types=["MULTIPLE_CHOICE"])
    assert typed["total"] == 0 and typed["course_total"] == 4
    assert by_type(typed) == {"MULTIPLE_CHOICE": 0}

    focused = available(member, course, unit_ids=[first, empty_unit])
    assert focused["total"] == 2
    assert focused["by_unit"] == [
        {"unit_id": first, "count": 2},
        {"unit_id": empty_unit, "count": 0},
    ]
    assert start(member, course, 3, unit_ids=[first, empty_unit]).status_code == 409

    midterm = scope(
        owner, course, academic_year="2025/26", kind="MIDTERM", name="MI", unit_ids=[first, second]
    )
    scoped = available(member, course, exam_scope_id=midterm["id"])
    # A question in two units counts once in the total and once per unit.
    assert scoped["total"] == 3
    assert scoped["by_unit"] == [{"unit_id": first, "count": 2}, {"unit_id": second, "count": 2}]

    # ADAPTIVE excludes questions in active sessions; STANDARD does not.
    active = start(member, course, 3, exam_scope_id=midterm["id"])
    assert active.status_code == 201, active.text
    adaptive = available(member, course, selection_mode="ADAPTIVE", exam_scope_id=midterm["id"])
    assert adaptive["total"] == 0 and adaptive["by_unit"][0]["count"] == 0
    assert available(member, course, selection_mode="ADAPTIVE")["total"] == 1
    assert available(member, course, exam_scope_id=midterm["id"])["total"] == 3
    adaptive_start = start(member, course, 1, selection_mode="ADAPTIVE", unit_ids=[first])
    assert adaptive_start.status_code == 409

    # A scope without units cannot be started, so nothing is available for it.
    final = scope(owner, course, academic_year="2025/26", kind="FINAL", name="ZI", unit_ids=[first])
    with engine.begin() as connection:
        connection.execute(
            text("DELETE FROM exam_scope_units WHERE scope_id = :id"), {"id": final["id"]}
        )
    assert available(member, course, exam_scope_id=final["id"])["total"] == 0
    assert start(member, course, 1, exam_scope_id=final["id"]).status_code == 409

    path = f"/courses/{course}/practice-availability"
    assert member.get(path, params={"unit_ids": [foreign]}).status_code == 422
    assert member.get(path, params={"unit_ids": [first, first]}).status_code == 422
    assert member.get(path, params={"exam_scope_id": str(uuid4())}).status_code == 404
    both = {"unit_ids": [first], "exam_scope_id": midterm["id"]}
    assert member.get(path, params=both).status_code == 422
    assert member.get(path, params={"question_types": ["ESSAY"]}).status_code == 422
    assert member.get(path, params={"selection_mode": "RANDOM"}).status_code == 422
    assert stranger.get(path).status_code in {403, 404}


def test_availability_counts_banks_beyond_one_page(bank):
    _, member, _, course, rows = bank
    approved = len(rows)
    for index in range(55):
        draft(member, course, f"Large bank {index}?", [])
    body = available(member, course, question_types=["TRUE_FALSE"])
    expected = 55 + sum(row["type"] == "TRUE_FALSE" for row in rows)
    assert body["total"] == expected
    assert body["course_total"] == approved + 55


def unit_progress(client, course):
    response = client.get(f"/courses/{course}/review-progress/units")
    assert response.status_code == 200, response.text
    return response.json()


def test_unit_progress_overlaps_units_and_ignores_pending(clients):
    owner, member, stranger, course = clients
    assert unit_progress(member, course)["units"] == []
    first = unit(owner, course, "Unit 1")
    second = unit(owner, course, "Unit 2")
    third = unit(owner, course, "Unit 3")
    order = {"unit_ids": [second, first, third]}
    assert owner.patch(f"/courses/{course}/units/order", json=order).status_code == 200
    assert owner.post(f"/units/{third}/archive").status_code == 200
    draft(member, course, "Only one?", [first])
    shared = draft(member, course, "Both?", [first, second])
    short = member.post(
        f"/courses/{course}/questions",
        json={
            "type": "SHORT_ANSWER",
            "stem": "Explain two?",
            "reference_answer": "Reference",
            "unit_ids": [second],
        },
    )
    assert short.status_code == 201, short.text

    attempt = start(member, course, 3, unit_ids=[first, second]).json()
    path = f"/courses/{course}/attempts/{attempt['id']}"
    answers = {
        "Only one?": {"type": "TRUE_FALSE", "value": True},
        "Both?": {"type": "TRUE_FALSE", "value": False},
        "Explain two?": {"type": "SHORT_ANSWER", "text": "My answer"},
    }
    for question in attempt["questions"]:
        response = member.patch(f"{path}/answers/{question['id']}", json=answers[question["stem"]])
        assert response.status_code == 200, response.text
    assert member.post(path + "/submit").status_code == 200
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE question_review_progress SET due_at = now() - interval '1 minute' "
                "WHERE question_id = :id"
            ),
            {"id": shared},
        )

    summary = unit_progress(member, course)
    assert summary["as_of"]
    rows = [
        {key: row[key] for key in row if key not in {"title", "position"}}
        for row in summary["units"]
    ]
    zero = {
        "reviewed_questions": 0,
        "resolved_review_count": 0,
        "correct_review_count": 0,
        "incorrect_review_count": 0,
        "due_now": 0,
    }
    assert rows == [
        # The pending short answer is not a resolved review and never counts as an error.
        {
            "unit_id": second,
            "is_archived": False,
            "reviewed_questions": 1,
            "resolved_review_count": 1,
            "correct_review_count": 0,
            "incorrect_review_count": 1,
            "due_now": 1,
        },
        {
            "unit_id": first,
            "is_archived": False,
            "reviewed_questions": 2,
            "resolved_review_count": 2,
            "correct_review_count": 1,
            "incorrect_review_count": 1,
            "due_now": 1,
        },
        {"unit_id": third, "is_archived": True} | zero,
    ]
    assert [row["title"] for row in summary["units"]] == ["Unit 2", "Unit 1", "Unit 3"]
    # Progress is private to each student.
    assert all(
        {key: row[key] for key in zero} == zero for row in unit_progress(owner, course)["units"]
    )
    assert stranger.get(f"/courses/{course}/review-progress/units").status_code in {403, 404}


def test_attempt_questions_show_live_units(clients):
    owner, member, stranger, course = clients
    first = unit(owner, course, "Unit 1")
    second = unit(owner, course, "Unit 2")
    third = unit(owner, course, "Unit 3")
    order = {"unit_ids": [second, first, third]}
    assert owner.patch(f"/courses/{course}/units/order", json=order).status_code == 200
    both = draft(member, course, "Both?", [first, second])
    draft(member, course, "Loose?", [])
    draft(member, course, "Retired?", [third])

    attempt = start(member, course, 3).json()
    path = f"/courses/{course}/attempts/{attempt['id']}"

    def units(body):
        return {q["stem"]: [(u["id"], u["title"]) for u in q["units"]] for q in body["questions"]}

    # Units follow course order, not the order they were assigned in.
    assert units(attempt) == {
        "Both?": [(second, "Unit 2"), (first, "Unit 1")],
        "Loose?": [],
        "Retired?": [(third, "Unit 3")],
    }
    assert all(set(u) == {"id", "title"} for q in attempt["questions"] for u in q["units"])

    # Units are organization read live; the frozen question snapshot is untouched.
    assert owner.patch(f"/units/{first}", json={"title": "Renamed"}).status_code == 200
    assert owner.post(f"/units/{third}/archive").status_code == 200
    live = member.get(path).json()
    assert units(live) == {
        "Both?": [(second, "Unit 2"), (first, "Renamed")],
        "Loose?": [],
        "Retired?": [],
    }
    assert [q["stem"] for q in live["questions"]] == [q["stem"] for q in attempt["questions"]]

    for question in live["questions"]:
        answer = {"type": "TRUE_FALSE", "value": True}
        response = member.patch(f"{path}/answers/{question['id']}", json=answer)
        assert response.status_code == 200, response.text
    submitted = member.post(path + "/submit")
    assert submitted.status_code == 200, submitted.text
    assert units(submitted.json())["Both?"] == [(second, "Unit 2"), (first, "Renamed")]

    unlinked = member.patch(f"/questions/{both}/units", json={"unit_ids": []})
    assert unlinked.status_code == 200, unlinked.text
    assert units(member.get(path).json())["Both?"] == []
    assert stranger.get(path).status_code in {403, 404}
