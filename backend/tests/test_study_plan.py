import os
from datetime import date, timedelta
from uuid import UUID, uuid4

import pytest
from test_exam_scopes_database import scope, unit
from test_materials import clients as clients

from app.services.study_plan import TopicInput, build_plan, state

A, B, C, D = (UUID(int=index) for index in range(1, 5))
TOPICS = [
    TopicInput(A, "Minimizacija", 1, exam_points=8, accuracy=0.4),  # review, need 4.8
    TopicInput(B, "Bistabili", 2, exam_points=6, accuracy=None),  # new, need 6
    TopicInput(C, "Sklopovi", 3, exam_points=10, accuracy=0.7),  # practice, need 3
    TopicInput(D, "Booleova algebra", 0, exam_points=4, accuracy=0.9),  # maintain
]


def plan_ids(week):
    return [(topic.unit_id, topic.work) for topic in week.topics]


def test_states_follow_the_accuracy():
    assert [state(topic) for topic in TOPICS] == ["REVIEW", "NEW", "PRACTICE", "MAINTAIN"]


def test_weeks_go_to_review_then_new_then_practice_in_proportion_to_need():
    # Wednesday 18 Nov 2026, exam on Monday 1 Feb 2027: twelve weeks, eleven of them for work.
    weeks, today, covered_by, after = build_plan(
        date(2026, 11, 18), date(2027, 2, 1), TOPICS, daily_minutes=40, due_today=3
    )
    assert len(weeks) == 12 and weeks[0].starts_on == date(2026, 11, 16)
    assert weeks[-1].exam_week and not any(week.exam_week for week in weeks[:-1])
    # Need 4.8 / 6 / 3 of 13.8 over 11 weeks: 4, 5 and 2 weeks.
    work = [[(u, w) for u, w in plan_ids(week) if w != "MAINTAIN"] for week in weeks]
    assert work[:4] == [[(A, "REVIEW")]] * 4
    assert work[4:9] == [[(B, "NEW")]] * 5
    assert work[9:11] == [[(C, "PRACTICE")]] * 2
    assert work[11] == []
    # Mastered topics are kept up in the first week and every fourth one.
    assert [week.index for week in weeks if (D, "MAINTAIN") in plan_ids(week)] == [0, 4, 8]
    # A mock exam in the exam week and every fourth week before it.
    assert [week.index for week in weeks if week.mock] == [3, 7, 11]
    assert covered_by == date(2027, 1, 31) and after == []
    assert [(t.unit_id, t.work) for t in today.topics] == [(A, "REVIEW")]
    assert today.questions == 26 and today.due == 3 and not today.mock


def test_a_short_window_lists_what_does_not_fit_and_the_exam_week_is_for_the_mock():
    weeks, today, covered_by, after = build_plan(
        date(2026, 11, 16), date(2026, 11, 30), TOPICS, daily_minutes=20, due_today=0
    )
    assert len(weeks) == 3
    assert [plan_ids(week)[0] for week in weeks[:2]] == [(A, "REVIEW"), (B, "NEW")]
    assert after == [C] and covered_by == date(2026, 11, 29)
    assert today.questions == 13
    same_week, today, covered_by, after = build_plan(
        date(2026, 11, 18), date(2026, 11, 20), TOPICS, daily_minutes=40, due_today=0
    )
    assert len(same_week) == 1 and same_week[0].exam_week and same_week[0].mock
    assert after == [A, B, C] and covered_by is None
    assert today.mock and [t.work for t in today.topics] == ["MAINTAIN"]


def test_without_past_papers_every_topic_weighs_the_same():
    topics = [
        TopicInput(A, "A", 0, exam_points=0, accuracy=0.5),
        TopicInput(B, "B", 1, exam_points=0, accuracy=0.2),
    ]
    weeks, *_ = build_plan(date(2026, 11, 16), date(2026, 12, 14), topics, 30, 0)
    # Need 0.5 and 0.8 on equal weights: the weaker one first, with more weeks.
    assert [plan_ids(week) for week in weeks[:3]] == [[(B, "REVIEW")]] * 2 + [[(A, "REVIEW")]]


@pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")
def test_settings_and_the_plan_through_the_api(clients):
    owner, member, stranger, course = clients
    logic = unit(owner, course, "Logika")
    sets = unit(owner, course, "Skupovi")
    exam_on = (date.today() + timedelta(days=30)).isoformat()
    final = scope(
        owner,
        course,
        academic_year="2026/27",
        kind="FINAL",
        name="Završni",
        unit_ids=[logic, sets],
        starts_on=exam_on,
    )
    path = f"/courses/{course}/study-plan"
    assert stranger.get(path).status_code == 404
    empty = member.get(path).json()
    assert empty["settings"] == {
        "exam_scope_id": None,
        "target_points": None,
        "daily_minutes": 40,
        "plan_enabled": False,
    }
    assert empty["exam"] is None and empty["weeks"] == [] and empty["today"] is None

    assert member.put(path, json={"daily_minutes": 5}).status_code == 422
    assert member.put(path, json={"exam_scope_id": str(uuid4())}).status_code == 422
    saved = member.put(
        path,
        json={
            "plan_enabled": True,
            "daily_minutes": 30,
            "target_points": 26,
            "exam_scope_id": final["id"],
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["target_points"] == 26.0 and saved.json()["daily_minutes"] == 30
    plan = member.get(path).json()
    assert plan["exam"]["scope_id"] == final["id"] and plan["exam"]["name"] == "Završni"
    assert plan["exam"]["days"] == 30
    titles = {topic["title"] for week in plan["weeks"] for topic in week["topics"]}
    assert titles == {"Logika", "Skupovi"}
    assert plan["weeks"][-1]["exam_week"] and plan["today"]["questions"] == 20
    # Another student has no plan of their own.
    assert owner.get(path).json()["settings"]["plan_enabled"] is False
    # Switched off, nothing of the plan is computed.
    member.put(path, json={"plan_enabled": False})
    assert member.get(path).json()["weeks"] == []
