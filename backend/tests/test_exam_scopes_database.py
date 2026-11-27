import os
from uuid import uuid4

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from community_helpers import create_course, provision, review_question
from fastapi.testclient import TestClient
from test_materials import clients as clients

from app.database import Base, engine
from app.main import app

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

TYPES = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"]


def unit(client, course: str, title: str) -> str:
    response = client.post(f"/courses/{course}/units", json={"title": title})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def scope(client, course: str, **body) -> dict:
    response = client.post(f"/courses/{course}/exam-scopes", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def draft(client, course: str, stem: str, unit_ids: list[str]) -> str:
    body = {"type": "TRUE_FALSE", "stem": stem, "correct_answer": True, "unit_ids": unit_ids}
    response = client.post(f"/courses/{course}/questions", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def start(client, course: str, count: int, **focus):
    body = {"count": count, "question_types": TYPES, "selection_mode": "STANDARD"} | focus
    return client.post(f"/courses/{course}/attempts", json=body)


def stems(attempt: dict) -> set[str]:
    return {question["stem"] for question in attempt["questions"]}


def test_scope_management_validation_and_copy(clients):
    owner, member, stranger, course = clients
    first = unit(owner, course, "Logika")
    second = unit(owner, course, "Skupovi")
    third = unit(owner, course, "Relacije")
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    other = create_course(owner, json={"name": "Other", "faculty_id": faculty}).json()["id"]
    foreign = unit(owner, other, "Foreign")
    path = f"/courses/{course}/exam-scopes"
    body = {"academic_year": "2025/26", "kind": "MIDTERM", "name": "Međuispit"}

    assert stranger.get(path).status_code == 404
    assert member.get(path).json() == []
    assert member.post(path, json=body | {"unit_ids": [first]}).status_code == 403
    for invalid in (
        body | {"academic_year": "2025/27", "unit_ids": [first]},
        body | {"academic_year": "2025-26", "unit_ids": [first]},
        body | {"kind": "EXAM", "unit_ids": [first]},
        body | {"name": " ", "unit_ids": [first]},
        body | {"unit_ids": []},
        body | {"unit_ids": [first, first]},
    ):
        assert owner.post(path, json=invalid).status_code == 422, invalid
    assert owner.post(path, json=body | {"unit_ids": [foreign]}).status_code == 422

    midterm = scope(owner, course, **body, unit_ids=[second, first])
    assert midterm["unit_ids"] == [first, second]  # Course order, not request order.
    assert midterm["approved_question_count"] == 0
    assert (
        owner.post(path, json=body | {"name": "MEĐUISPIT", "unit_ids": [first]}).status_code == 409
    )
    final = scope(
        owner, course, academic_year="2025/26", kind="FINAL", name="Završni", unit_ids=[third]
    )
    older = scope(
        owner, course, academic_year="2024/25", kind="MIDTERM", name="Međuispit", unit_ids=[first]
    )
    full = scope(
        owner,
        course,
        academic_year="2025/26",
        kind="FULL_EXAM",
        name="Ispitni rok",
        unit_ids=[first, second, third],
    )
    assert [row["id"] for row in member.get(path).json()] == [
        midterm["id"],
        final["id"],
        full["id"],
        older["id"],
    ]
    assert [row["id"] for row in member.get(f"{path}?academic_year=2024/25").json()] == [
        older["id"]
    ]
    assert member.get(f"{path}?academic_year=2024").status_code == 422

    scope_path = f"/exam-scopes/{midterm['id']}"
    assert member.patch(scope_path, json={"name": "MI"}).status_code == 403
    assert owner.patch(f"/exam-scopes/{uuid4()}", json={"name": "MI"}).status_code == 404
    assert owner.patch(scope_path, json={}).status_code == 422
    assert owner.patch(scope_path, json={"name": None}).status_code == 422
    assert owner.patch(scope_path, json={"name": "Završni"}).status_code == 409
    changed = owner.patch(scope_path, json={"name": "1. međuispit", "unit_ids": [first]})
    assert changed.status_code == 200, changed.text
    assert changed.json()["name"] == "1. međuispit" and changed.json()["unit_ids"] == [first]

    copy = f"/courses/{course}/exam-scopes/copy"
    assert member.post(copy, json={"from_year": "2025/26", "to_year": "2026/27"}).status_code == 403
    assert owner.post(copy, json={"from_year": "2025/26", "to_year": "2025/26"}).status_code == 422
    assert owner.post(copy, json={"from_year": "2019/20", "to_year": "2026/27"}).status_code == 404
    copied = owner.post(copy, json={"from_year": "2025/26", "to_year": "2026/27"})
    assert copied.status_code == 201, copied.text
    assert [(row["name"], row["academic_year"]) for row in copied.json()] == [
        ("1. međuispit", "2026/27"),
        ("Završni", "2026/27"),
        ("Ispitni rok", "2026/27"),
    ]
    assert owner.post(copy, json={"from_year": "2025/26", "to_year": "2026/27"}).status_code == 409

    # Copies link active units only and skip scopes left without any.
    assert owner.post(f"/units/{third}/archive").status_code == 200
    later = owner.post(copy, json={"from_year": "2025/26", "to_year": "2027/28"}).json()
    assert [(row["name"], row["unit_ids"]) for row in later] == [
        ("1. međuispit", [first]),
        ("Ispitni rok", [first, second]),
    ]
    # Existing scopes keep archived units; new links need active ones.
    assert (
        owner.patch(f"/exam-scopes/{full['id']}", json={"unit_ids": [first, third]}).status_code
        == 200
    )
    assert owner.patch(scope_path, json={"unit_ids": [first, third]}).status_code == 422

    assert member.delete(scope_path).status_code == 403
    assert owner.delete(scope_path).status_code == 204
    assert owner.delete(scope_path).status_code == 404
    assert midterm["id"] not in [row["id"] for row in member.get(path).json()]


def test_practice_focuses_on_units_or_an_exam_scope(clients):
    owner, member, _, course = clients
    first = unit(owner, course, "Unit 1")
    second = unit(owner, course, "Unit 2")
    third = unit(owner, course, "Unit 3")
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    other = create_course(owner, json={"name": "Other", "faculty_id": faculty}).json()["id"]
    foreign = unit(owner, other, "Foreign")
    foreign_scope = scope(
        owner, other, academic_year="2025/26", kind="MIDTERM", name="MI", unit_ids=[foreign]
    )
    draft(member, course, "One?", [first])
    draft(member, course, "Two?", [second])
    draft(member, course, "Three?", [third])
    draft(member, course, "Loose?", [])
    shared = draft(member, course, "One and two?", [first, second])

    focused = start(member, course, 2, unit_ids=[first])
    assert focused.status_code == 201, focused.text
    attempt = focused.json()
    assert stems(attempt) == {"One?", "One and two?"}
    assert attempt["focus_unit_ids"] == [first] and attempt["focus_label"] == "Unit 1"
    assert attempt["exam_scope_id"] is None
    too_many = start(member, course, 3, unit_ids=[first])
    assert too_many.status_code == 409
    assert "type or unit filter" in too_many.json()["detail"]
    assert start(member, course, 1, unit_ids=[foreign]).status_code == 422
    assert start(member, course, 1, unit_ids=[first, first]).status_code == 422

    midterm = scope(
        owner, course, academic_year="2025/26", kind="MIDTERM", name="MI", unit_ids=[first, second]
    )
    assert member.get(f"/courses/{course}/exam-scopes").json()[0]["approved_question_count"] == 0
    approve = member.post(f"/questions/{shared}/submit")
    assert approve.status_code == 200
    assert review_question(member, f"/questions/{shared}/approve").status_code == 200
    assert member.get(f"/courses/{course}/exam-scopes").json()[0]["approved_question_count"] == 1

    by_scope = start(member, course, 3, exam_scope_id=midterm["id"])
    assert by_scope.status_code == 201, by_scope.text
    scoped = by_scope.json()
    assert stems(scoped) == {"One?", "Two?", "One and two?"}
    assert scoped["exam_scope_id"] == midterm["id"]
    assert scoped["focus_unit_ids"] == [first, second]
    assert scoped["focus_label"] == "MI 2025/26"
    assert start(member, course, 1, exam_scope_id=foreign_scope["id"]).status_code == 404
    assert start(member, course, 1, exam_scope_id=str(uuid4())).status_code == 404
    both = start(member, course, 1, unit_ids=[first], exam_scope_id=midterm["id"])
    assert both.status_code == 422

    adaptive = start(member, course, 1, unit_ids=[third], selection_mode="ADAPTIVE")
    assert adaptive.status_code == 201 and stems(adaptive.json()) == {"Three?"}
    whole = start(member, course, 5)
    assert whole.status_code == 201 and whole.json()["focus_label"] is None
    assert whole.json()["focus_unit_ids"] == []

    # Deleting a scope keeps the frozen label on past practice.
    assert owner.delete(f"/exam-scopes/{midterm['id']}").status_code == 204
    history = {row["id"]: row for row in member.get(f"/courses/{course}/attempts").json()}
    assert history[scoped["id"]]["focus_label"] == "MI 2025/26"
    assert history[scoped["id"]]["exam_scope_id"] is None
    assert history[attempt["id"]]["focus_label"] == "Unit 1"
    assert member.get(f"/courses/{course}/attempts/{scoped['id']}").json()["focus_label"] == (
        "MI 2025/26"
    )


def test_enrolled_faculty_moderator_manages_scopes(clients):
    owner, member, _, course = clients
    first = unit(owner, course, "Logika")
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    path = f"/courses/{course}/exam-scopes"
    body = {"academic_year": "2025/26", "kind": "MIDTERM", "name": "Međuispit", "unit_ids": [first]}
    with TestClient(app) as outsider:
        outsider.post(
            "/auth/register",
            json={
                "email": "scope-moderator@example.com",
                "password": "correct horse",
                "display_name": "Moderator",
            },
        )
        provision(outsider, faculty)
        # A moderator who has not joined the course cannot see it, as before.
        assert outsider.post(path, json=body).status_code == 404
    # An enrolled member who is not a moderator is refused until made one.
    assert member.post(path, json=body).status_code == 403
    provision(member, faculty)

    created = scope(member, course, **body)
    scope_path = f"/exam-scopes/{created['id']}"
    dated = {"name": "MI", "starts_on": "2025-11-24"}
    assert member.patch(scope_path, json=dated).status_code == 200
    copied = member.post(path + "/copy", json={"from_year": "2025/26", "to_year": "2026/27"})
    assert copied.status_code == 201, copied.text
    assert owner.get(path).json()[0]["name"] == "MI"
    assert member.delete(scope_path).status_code == 204


def test_platform_owner_manages_every_course(clients, monkeypatch):
    owner, _, stranger, course = clients
    first = unit(owner, course, "Logika")
    path = f"/courses/{course}/exam-scopes"
    body = {"academic_year": "2025/26", "kind": "MIDTERM", "name": "Međuispit", "unit_ids": [first]}
    assert stranger.get(path).status_code == 404
    assert stranger.post(path, json=body).status_code == 404

    stranger_id = stranger.get("/auth/me").json()["id"]
    monkeypatch.setenv("PLATFORM_OWNER_USER_IDS", stranger_id)
    created = scope(stranger, course, **body)
    scope_path = f"/exam-scopes/{created['id']}"
    assert stranger.get(path).status_code == 200
    assert stranger.patch(scope_path, json={"name": "MI"}).status_code == 200
    copy = {"from_year": "2025/26", "to_year": "2026/27"}
    assert stranger.post(path + "/copy", json=copy).status_code == 201
    assert stranger.delete(scope_path).status_code == 204
    # Beyond exam scopes: units, past papers and the course itself.
    assert stranger.post(f"/courses/{course}/units", json={"title": "Skupovi"}).status_code == 201
    assert stranger.get(f"/courses/{course}/exam-papers").json()["can_manage"] is True
    assert stranger.get(f"/courses/{course}").status_code == 200
    assert stranger.post(f"/courses/{course}/archive").status_code == 200
    assert stranger.post(f"/courses/{course}/restore").status_code == 200

    monkeypatch.delenv("PLATFORM_OWNER_USER_IDS")
    assert stranger.get(path).status_code == 404


def test_model_migration_parity():
    with engine.begin() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "compare_server_default": True,
                "include_object": lambda obj, name, type_, reflected, compare_to: (
                    type_ != "table" or name in {"exam_scopes", "exam_scope_units", "quizzes"}
                ),
            },
        )
        assert compare_metadata(context, Base.metadata) == []
