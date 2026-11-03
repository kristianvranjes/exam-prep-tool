import os
from datetime import UTC, datetime, timedelta

import pytest
from community_helpers import review_question
from test_exam_scopes_database import draft, scope, unit
from test_favorites_database import approved
from test_materials import clients as clients
from test_practice_modes_database import (
    answer_and_submit,
    available,
    set_progress,
    started,
    stems,
)

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

FIELDS = {
    "question_id",
    "type",
    "stem",
    "difficulty",
    "units",
    "last_reviewed_at",
    "incorrect_review_count",
    "available",
}


def mistakes(client, course, **params):
    response = client.get(f"/courses/{course}/mistakes", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def listed(client, course, **params):
    return [row["stem"] for row in mistakes(client, course, **params)]


def test_mistakes_list_follows_practice_without_leaking_keys(clients):
    owner, member, stranger, course = clients
    first = unit(owner, course, "Unit 1")
    second = unit(owner, course, "Unit 2")
    ids = {
        "A?": draft(member, course, "A?", [first]),
        "B?": draft(member, course, "B?", [second]),
        "AB?": draft(member, course, "AB?", [first, second]),
    }
    explained = member.post(
        f"/courses/{course}/questions",
        json={
            "type": "TRUE_FALSE",
            "stem": "Explained?",
            "correct_answer": True,
            "explanation": "SECRET-EXPLANATION",
            "unit_ids": [],
        },
    )
    assert explained.status_code == 201, explained.text
    ids["Explained?"] = explained.json()["id"]
    short = member.post(
        f"/courses/{course}/questions",
        json={
            "type": "SHORT_ANSWER",
            "stem": "Explain?",
            "reference_answer": "SECRET-REFERENCE",
            "unit_ids": [first],
        },
    )
    assert short.status_code == 201, short.text
    assert mistakes(member, course) == []

    attempt = started(member, course, 5, "STANDARD")
    answer_and_submit(member, course, attempt, correct={"AB?"})
    # Even a self-assessed wrong short answer stays pending and never becomes a mistake.
    path = f"/courses/{course}/attempts/{attempt['id']}"
    pending = next(q for q in attempt["questions"] if q["type"] == "SHORT_ANSWER")
    marked = member.patch(
        f"{path}/answers/{pending['id']}/self-review", json={"verdict": "INCORRECT"}
    )
    assert marked.status_code == 200, marked.text

    rows = mistakes(member, course)
    assert all(set(row) == FIELDS for row in rows)
    for secret in ("SECRET-EXPLANATION", "SECRET-REFERENCE", "correct_answer", "explanation"):
        assert secret not in str(rows)
    # Same set and order as MISTAKES practice: oldest last review first, then question ID.
    older = datetime.now(UTC) - timedelta(days=3)
    set_progress(member, [ids["Explained?"]], last_reviewed_at=older)
    tied = sorted(["A?", "B?"], key=lambda stem: ids[stem])
    assert listed(member, course) == ["Explained?", *tied]
    assert available(member, course)["mistakes_total"] == 3
    explained_row = mistakes(member, course)[0]
    assert explained_row["type"] == "TRUE_FALSE" and explained_row["available"] is True
    assert explained_row["incorrect_review_count"] == 1 and explained_row["units"] == []
    by_stem = {row["stem"]: row for row in rows}
    assert by_stem["A?"]["units"] == [{"id": first, "title": "Unit 1"}]

    # The same focus filters as practice.
    assert listed(member, course, unit_ids=[first]) == ["A?"]
    midterm = scope(
        owner, course, academic_year="2025/26", kind="MIDTERM", name="MI", unit_ids=[first, second]
    )
    assert listed(member, course, exam_scope_id=midterm["id"]) == tied
    assert listed(member, course, question_types=["SHORT_ANSWER"]) == []
    assert listed(member, course, question_types=["TRUE_FALSE"]) == ["Explained?", *tied]
    both = member.get(
        f"/courses/{course}/mistakes", params={"unit_ids": [first], "exam_scope_id": midterm["id"]}
    )
    assert both.status_code == 422

    # Paginated like the other lists.
    assert listed(member, course, limit=2) == ["Explained?", tied[0]]
    assert listed(member, course, limit=2, offset=2) == [tied[1]]
    for params in ({"limit": 0}, {"limit": 101}, {"offset": -1}, {"offset": 10001}):
        assert member.get(f"/courses/{course}/mistakes", params=params).status_code == 422

    # Private to course members, and to the student who made them.
    assert stranger.get(f"/courses/{course}/mistakes").status_code == 404
    assert stranger.post(f"/courses/{course}/join").status_code == 200
    assert mistakes(stranger, course) == []
    assert mistakes(owner, course) == []

    # A later correct answer removes the question; another miss keeps it.
    review = started(member, course, 3, "MISTAKES")
    assert stems(review) == ["Explained?", *tied]
    answer_and_submit(member, course, review, correct={"A?", "Explained?"})
    assert listed(member, course) == ["B?"]
    assert mistakes(member, course)[0]["incorrect_review_count"] == 2


def test_ineligible_mistakes_are_listed_last_and_unavailable(clients):
    owner, member, _, course = clients
    shared = approved(owner, course, "Shared?", [])
    rework = draft(member, course, "Rework?", [])
    kept = draft(member, course, "Kept?", [])
    attempt = started(member, course, 3, "STANDARD")
    answer_and_submit(member, course, attempt, correct=set())
    older = datetime.now(UTC) - timedelta(days=3)
    set_progress(member, [shared, rework], last_reviewed_at=older)

    assert member.post(f"/questions/{rework}/submit").status_code == 200
    reason = {"reason": "Needs rework"}
    assert review_question(owner, f"/questions/{rework}/reject", json=reason).status_code == 200
    assert review_question(owner, f"/questions/{shared}/archive").status_code == 200

    rows = mistakes(member, course)
    # Both were reviewed at the same time, so question ID orders them.
    ordered = [stem for _, stem in sorted([(rework, "Rework?"), (shared, "Shared?")])]
    assert [(row["stem"], row["available"]) for row in rows] == [
        ("Kept?", True),
        *((stem, False) for stem in ordered),
    ]
    # Practice selects only what the list marks available.
    counts = available(member, course, selection_mode="MISTAKES")
    assert counts["total"] == counts["mistakes_total"] == 1
    assert stems(started(member, course, 1, "MISTAKES")) == ["Kept?"]
    assert kept in {row["question_id"] for row in rows}
