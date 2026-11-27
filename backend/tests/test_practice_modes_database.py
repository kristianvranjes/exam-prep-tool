import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from community_helpers import review_question
from sqlalchemy import text, update
from test_exam_scopes_database import draft, scope, unit
from test_materials import clients as clients

from app.database import SessionLocal, engine
from app.models.user_question_progress import UserQuestionProgress

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

TYPES = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"]


def available(client, course, **params):
    response = client.get(f"/courses/{course}/practice-availability", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def start(client, course, count, mode, **focus):
    body = {"count": count, "question_types": TYPES, "selection_mode": mode} | focus
    return client.post(f"/courses/{course}/attempts", json=body)


def started(client, course, count, mode, **focus):
    response = start(client, course, count, mode, **focus)
    assert response.status_code == 201, response.text
    return response.json()


def stems(attempt):
    return [question["stem"] for question in attempt["questions"]]


def answer_and_submit(client, course, attempt, correct):
    """Answer true/false drafts (key: true) correctly when their stem is in `correct`."""
    path = f"/courses/{course}/attempts/{attempt['id']}"
    for question in attempt["questions"]:
        if question["type"] == "SHORT_ANSWER":
            body = {"type": "SHORT_ANSWER", "text": "Reference"}
        else:
            body = {"type": "TRUE_FALSE", "value": question["stem"] in correct}
        response = client.patch(f"{path}/answers/{question['id']}", json=body)
        assert response.status_code == 200, response.text
    response = client.post(f"{path}/submit")
    assert response.status_code == 200, response.text


def set_progress(client, question_ids, **values):
    user_id = UUID(client.get("/auth/me").json()["id"])
    with SessionLocal() as db:
        db.execute(
            update(UserQuestionProgress)
            .where(
                UserQuestionProgress.user_id == user_id,
                UserQuestionProgress.question_id.in_([UUID(id_) for id_ in question_ids]),
            )
            .values(**values)
        )
        db.commit()


def add_progress(client, question_id, due_at, last_result="CORRECT"):
    user_id = UUID(client.get("/auth/me").json()["id"])
    with SessionLocal() as db:
        db.add(
            UserQuestionProgress(
                user_id=user_id,
                question_id=UUID(question_id),
                review_stage=1,
                resolved_review_count=1,
                correct_review_count=int(last_result == "CORRECT"),
                incorrect_review_count=int(last_result == "INCORRECT"),
                last_result=last_result,
                last_reviewed_at=due_at - timedelta(days=1),
                due_at=due_at,
                scheduling_version="leitner-v1",
            )
        )
        db.commit()


def test_mistakes_follow_the_latest_resolved_result(clients):
    owner, member, _, course = clients
    first = unit(owner, course, "Unit 1")
    second = unit(owner, course, "Unit 2")
    ids = {
        "A?": draft(member, course, "A?", [first]),
        "B?": draft(member, course, "B?", [second]),
        "AB?": draft(member, course, "AB?", [first, second]),
        "Loose?": draft(member, course, "Loose?", []),
    }
    short = member.post(
        f"/courses/{course}/questions",
        json={
            "type": "SHORT_ANSWER",
            "stem": "Explain?",
            "reference_answer": "Reference",
            "unit_ids": [first],
        },
    )
    assert short.status_code == 201, short.text
    assert available(member, course, selection_mode="MISTAKES")["total"] == 0
    assert start(member, course, 1, "MISTAKES").status_code == 409

    attempt = started(member, course, 5, "STANDARD")
    answer_and_submit(member, course, attempt, correct={"AB?"})
    # A pending short answer is never a mistake.
    whole = available(member, course, selection_mode="MISTAKES")
    assert whole["total"] == whole["mistakes_total"] == 3
    assert available(member, course)["mistakes_total"] == 3
    assert available(member, course, selection_mode="MISTAKES", unit_ids=[first])["total"] == 1
    midterm = scope(
        owner, course, academic_year="2025/26", kind="MIDTERM", name="MI", unit_ids=[first, second]
    )
    scoped = available(member, course, selection_mode="MISTAKES", exam_scope_id=midterm["id"])
    assert scoped["total"] == 2
    assert scoped["by_unit"] == [{"unit_id": first, "count": 1}, {"unit_id": second, "count": 1}]
    typed = available(member, course, selection_mode="MISTAKES", question_types=["SHORT_ANSWER"])
    assert typed["total"] == 0

    # Oldest last review first; equal times fall back to question ID.
    older = datetime.now(UTC) - timedelta(days=3)
    set_progress(member, [ids["Loose?"]], last_reviewed_at=older)
    tied = sorted(["A?", "B?"], key=lambda stem: ids[stem])
    refused = start(member, course, 4, "MISTAKES")
    assert refused.status_code == 409 and "Only 3 eligible" in refused.json()["detail"]
    review = started(member, course, 3, "MISTAKES")
    assert stems(review) == ["Loose?", *tied]
    # Sources in an unfinished session are excluded until it closes.
    assert available(member, course, selection_mode="MISTAKES")["total"] == 0
    assert available(member, course)["mistakes_total"] == 0

    # A later correct answer removes the question; another miss keeps it.
    answer_and_submit(member, course, review, correct={"A?"})
    assert available(member, course, selection_mode="MISTAKES")["total"] == 2
    # Both misses were reviewed in the same submission, so question ID orders them.
    remaining = sorted(["B?", "Loose?"], key=lambda stem: ids[stem])
    assert stems(started(member, course, 2, "MISTAKES")) == remaining


def test_due_review_selects_only_due_questions(clients):
    owner, member, _, course = clients
    first = unit(owner, course, "Unit 1")
    ids = [draft(member, course, f"Q{index}?", [first] if index == 0 else []) for index in range(6)]
    now = datetime.now(UTC)
    add_progress(member, ids[0], now - timedelta(days=1))
    add_progress(member, ids[1], now - timedelta(days=2), last_result="INCORRECT")
    add_progress(member, ids[2], now + timedelta(days=1))
    add_progress(member, ids[4], now - timedelta(days=1))
    add_progress(member, ids[5], now - timedelta(days=5))
    # Archived sources keep their progress but are no longer eligible.
    approved = draft(owner, course, "Archived?", [])
    assert owner.post(f"/questions/{approved}/submit").status_code == 200
    assert review_question(owner, f"/questions/{approved}/approve").status_code == 200
    add_progress(member, approved, now - timedelta(days=9))
    assert review_question(owner, f"/questions/{approved}/archive").status_code == 200

    whole = available(member, course, selection_mode="DUE")
    assert whole["total"] == whole["due_total"] == 4
    assert available(member, course, selection_mode="DUE", unit_ids=[first])["total"] == 1
    refused = start(member, course, 5, "DUE")
    assert refused.status_code == 409 and "Only 4 eligible" in refused.json()["detail"]

    # Earliest due first; equal due times fall back to question ID.
    tied = sorted(["Q0?", "Q4?"], key=lambda stem: ids[int(stem[1])])
    assert stems(started(member, course, 4, "DUE")) == ["Q5?", "Q1?", *tied]
    assert available(member, course, selection_mode="DUE")["total"] == 0
    # Standard practice still counts every eligible question.
    assert available(member, course)["total"] == 6


def test_mock_exam_spreads_the_scope_across_its_units(clients):
    owner, member, _, course = clients
    first = unit(owner, course, "Unit 1")
    second = unit(owner, course, "Unit 2")
    outside = unit(owner, course, "Unit 3")
    shared = draft(member, course, "S?", [first, second])
    ids = {"S?": shared}
    for stem, units in [
        ("A1?", [first]),
        ("A2?", [first]),
        ("A3?", [first]),
        ("A4?", [first]),
        ("B1?", [second]),
        ("B2?", [second]),
        ("B3?", [second]),
        ("C1?", [outside]),
        ("Loose?", []),
    ]:
        ids[stem] = draft(member, course, stem, units)
    midterm = scope(
        owner, course, academic_year="2025/26", kind="MIDTERM", name="MI", unit_ids=[first, second]
    )
    focus = {"exam_scope_id": midterm["id"]}
    assert start(member, course, 1, "MOCK").status_code == 422
    assert start(member, course, 1, "MOCK", unit_ids=[first]).status_code == 422
    path = f"/courses/{course}/practice-availability"
    assert member.get(path, params={"selection_mode": "MOCK"}).status_code == 422
    counts = available(member, course, selection_mode="MOCK", **focus)
    assert counts["total"] == 8
    assert start(member, course, 9, "MOCK", **focus).status_code == 409

    # Within a unit the adaptive ranking applies: A3 is due, so unit 1 starts with it.
    add_progress(member, ids["A3?"], datetime.now(UTC) - timedelta(hours=1))
    mock = started(member, course, 5, "MOCK", feedback_mode="END", **focus)
    # Rounds: (A3, S), (A1, B1), (A2). The shared question counts once, for unit 2.
    assert stems(mock) == ["A3?", "A1?", "A2?", "S?", "B1?"]
    assert mock["exam_scope_id"] == midterm["id"] and mock["focus_label"] == "MI 2025/26"
    assert mock["feedback_mode"] == "END"

    # Active sources are excluded; an exhausted unit drops out and the rest fill up.
    assert available(member, course, selection_mode="MOCK", **focus)["total"] == 3
    assert stems(started(member, course, 3, "MOCK", **focus)) == ["A4?", "B2?", "B3?"]
    assert start(member, course, 1, "MOCK", **focus).status_code == 409

    # A scope whose units were all removed cannot start a mock exam either.
    with engine.begin() as connection:
        connection.execute(
            text("DELETE FROM exam_scope_units WHERE scope_id = :id"), {"id": midterm["id"]}
        )
    assert available(member, course, selection_mode="MOCK", **focus)["total"] == 0
    refused = start(member, course, 1, "MOCK", **focus)
    assert refused.status_code == 409 and "no units" in refused.json()["detail"]


def test_mistakes_first_puts_the_course_mistakes_before_the_chosen_topics(clients):
    owner, member, _, course = clients
    first = unit(owner, course, "Unit 1")
    second = unit(owner, course, "Unit 2")
    for stem in ("A1?", "A2?"):
        draft(member, course, stem, [first])
    for stem in ("B1?", "B2?", "B3?"):
        draft(member, course, stem, [second])
    attempt = started(member, course, 5, "STANDARD")
    answer_and_submit(member, course, attempt, correct={"A2?", "B2?", "B3?"})
    topic = {"include_mistakes": True, "unit_ids": [second]}

    # Only an ADAPTIVE practice takes the option.
    assert start(member, course, 1, "STANDARD", include_mistakes=True).status_code == 422
    assert start(member, course, 1, "MISTAKES", include_mistakes=True).status_code == 422
    # The pool is the course's mistakes plus the topic, each question once: 2 + (3 - 1) = 4.
    refused = start(member, course, 5, "ADAPTIVE", **topic)
    assert refused.status_code == 409 and "Only 4 eligible" in refused.json()["detail"]

    mixed = stems(started(member, course, 3, "ADAPTIVE", **topic))
    # Both mistakes come first, also the one from another topic; then the topic's own questions.
    assert sorted(mixed[:2]) == ["A1?", "B1?"]
    assert mixed[2] in {"B2?", "B3?"}


def test_standard_and_adaptive_cover_every_focused_unit(clients):
    owner, member, _, course = clients
    first = unit(owner, course, "Unit 1")
    second = unit(owner, course, "Unit 2")
    third = unit(owner, course, "Unit 3")
    # Everything is unseen and unit 1 holds the oldest questions, so one ranking over all
    # focused units would fill a short session from unit 1 alone.
    for stem, units in [
        ("A1?", [first]),
        ("A2?", [first]),
        ("A3?", [first]),
        ("B1?", [second]),
        ("B2?", [second]),
        ("C1?", [third]),
    ]:
        draft(member, course, stem, units)
    all_units = {"unit_ids": [first, second, third]}

    # Adaptive: one question from each unit, listed by unit.
    assert stems(started(member, course, 3, "ADAPTIVE", **all_units)) == ["A1?", "B1?", "C1?"]
    # Those are now waiting in a session; unit 3 is exhausted and the others fill up.
    assert stems(started(member, course, 3, "ADAPTIVE", **all_units)) == ["A2?", "A3?", "B2?"]

    # Standard keeps creation order inside each unit and does not skip active questions.
    pair = {"unit_ids": [first, second]}
    assert stems(started(member, course, 2, "STANDARD", **pair)) == ["A1?", "B1?"]
    assert stems(started(member, course, 3, "STANDARD", **pair)) == ["A1?", "A2?", "B1?"]
    # One unit, or the whole course, is still the oldest questions first.
    assert stems(started(member, course, 2, "STANDARD", unit_ids=[first])) == ["A1?", "A2?"]
    assert stems(started(member, course, 2, "STANDARD")) == ["A1?", "A2?"]


def test_mistakes_first_spreads_its_adaptive_part_over_the_chosen_units(clients):
    owner, member, _, course = clients
    first = unit(owner, course, "Unit 1")
    second = unit(owner, course, "Unit 2")
    for stem, units in [("A1?", [first]), ("A2?", [first]), ("A3?", [first]), ("B1?", [second])]:
        draft(member, course, stem, units)
    # No mistakes yet, so the whole session is the adaptive part over both units.
    chosen = {"include_mistakes": True, "unit_ids": [first, second]}
    assert stems(started(member, course, 2, "ADAPTIVE", **chosen)) == ["A1?", "B1?"]
