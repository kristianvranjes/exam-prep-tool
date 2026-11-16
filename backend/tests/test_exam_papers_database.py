import os
from uuid import uuid4

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from community_helpers import create_course, provision, review_question
from fastapi.testclient import TestClient
from test_exam_scopes_database import draft, scope, unit
from test_practice_database import bank as bank
from test_practice_database import clients as clients

from app.database import Base, engine
from app.main import app

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

BODY = {
    "academic_year": "2025/26",
    "kind": "MIDTERM",
    "title": "Međuispit 2025/26",
    "term_label": "Jesenski rok",
    "exam_date": "2025-11-24",
    "duration_minutes": 90,
    "wrong_answer_penalty": 0.25,
    "pass_threshold": 4,
}


def create(client, course, **changes):
    response = client.post(f"/courses/{course}/exam-papers", json=BODY | changes)
    assert response.status_code == 201, response.text
    return response.json()


def items(rows, points=(2, 1.5, 3)):
    return {
        "items": [
            {"question_id": row["id"], "points": value, "label": f"Zadatak {index + 1}"}
            for index, (row, value) in enumerate(zip(rows, points, strict=False))
        ]
    }


def test_lifecycle_and_member_visibility(bank):
    owner, member, stranger, course, rows = bank
    papers = f"/courses/{course}/exam-papers"
    assert member.get(papers).json() == {"can_manage": False, "papers": []}
    assert stranger.get(papers).status_code == 404
    assert member.post(papers, json=BODY).status_code == 403
    paper = create(owner, course)
    assert paper["status"] == "DRAFT" and paper["can_manage"] is True
    assert (paper["item_count"], paper["total_points"], paper["wrong_answer_penalty"]) == (
        0,
        0,
        0.25,
    )
    path = f"/exam-papers/{paper['id']}"
    assert member.get(path).status_code == 404
    assert member.post(path + "/items", json=items(rows)).status_code == 403

    saved = owner.post(path + "/items", json=items(rows))
    assert saved.status_code == 200, saved.text
    saved = saved.json()
    assert [item["label"] for item in saved["items"]] == ["Zadatak 1", "Zadatak 2", "Zadatak 3"]
    assert [item["question_id"] for item in saved["items"]] == [row["id"] for row in rows]
    assert saved["items"][0]["stem"] == rows[0]["stem"]
    assert (saved["item_count"], saved["total_points"]) == (3, 6.5)
    # Reordering is a full replacement in the new order.
    reordered = owner.post(path + "/items", json=items(rows[::-1], points=(1, 1))).json()
    assert [item["question_id"] for item in reordered["items"]] == [rows[2]["id"], rows[1]["id"]]
    assert owner.post(path + "/items", json=items(rows)).status_code == 200

    published = owner.post(path + "/publish")
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "PUBLISHED" and published.json()["published_at"]
    assert owner.post(path + "/publish").json() == published.json()
    listed = member.get(papers).json()
    assert listed["can_manage"] is False
    assert [(p["title"], p["item_count"], p["total_points"]) for p in listed["papers"]] == [
        ("Međuispit 2025/26", 3, 6.5)
    ]
    public = member.get(path).json()
    assert public["can_manage"] is False
    for item in public["items"]:
        assert set(item) == {"position", "label", "points", "type"}
    assert owner.post(path + "/items", json=items(rows)).status_code == 409
    assert owner.delete(path).status_code == 409
    # Metadata stays editable while published.
    renamed = owner.patch(path, json={"title": "MI 2025/26", "term_label": None})
    assert renamed.status_code == 200, renamed.text
    assert (renamed.json()["title"], renamed.json()["term_label"]) == ("MI 2025/26", None)

    assert owner.post(path + "/unpublish").json()["status"] == "DRAFT"
    assert member.get(path).status_code == 404
    assert member.get(papers).json()["papers"] == []
    assert owner.delete(path).status_code == 204
    assert owner.get(path).status_code == 404


def test_validation_and_publish_guards(bank):
    owner, member, _, course, rows = bank
    paper = create(owner, course)
    path = f"/exam-papers/{paper['id']}"
    assert owner.post(f"/courses/{course}/exam-papers", json=BODY).status_code == 409
    assert create(owner, course, academic_year="2024/25")["academic_year"] == "2024/25"
    assert owner.post(path + "/publish").status_code == 409
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    other = create_course(owner, json={"name": "Other", "faculty_id": faculty}).json()["id"]
    foreign_scope = scope(
        owner,
        other,
        academic_year="2025/26",
        kind="MIDTERM",
        name="MI",
        unit_ids=[unit(owner, other, "Foreign")],
    )
    assert owner.patch(path, json={"exam_scope_id": foreign_scope["id"]}).status_code == 422
    own_scope = scope(
        owner,
        course,
        academic_year="2025/26",
        kind="MIDTERM",
        name="MI",
        unit_ids=[unit(owner, course, "Logika")],
    )
    linked = owner.patch(path, json={"exam_scope_id": own_scope["id"]}).json()
    assert linked["exam_scope_id"] == own_scope["id"]
    for invalid in (
        {"items": [{"question_id": str(uuid4()), "points": 1}]},
        {"items": [{"question_id": rows[0]["id"], "points": 0.125}]},
        {"items": [{"question_id": rows[0]["id"], "points": 0}]},
        {"items": [{"question_id": rows[0]["id"], "points": 1}] * 2},
    ):
        assert owner.post(path + "/items", json=invalid).status_code == 422, invalid
    pending = draft(member, course, "A member's unreviewed draft", [])
    response = owner.post(path + "/items", json={"items": [{"question_id": pending, "points": 1}]})
    assert response.status_code == 409 and "not approved" in response.text
    assert owner.post(path + "/items", json=items(rows)).status_code == 200
    # A question archived after it was added blocks publishing.
    assert review_question(owner, f"/questions/{rows[0]['id']}/archive").status_code == 200
    blocked = owner.post(path + "/publish")
    assert blocked.status_code == 409 and "no longer approved" in blocked.text
    assert owner.post(path + "/items", json=items(rows[1:])).status_code == 200
    assert owner.post(path + "/publish").status_code == 200


def test_unenrolled_faculty_moderator_manages_papers(bank):
    owner, member, _, course, rows = bank
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    with TestClient(app) as moderator:
        moderator.post(
            "/auth/register",
            json={
                "email": "paper-moderator@example.com",
                "password": "correct horse",
                "display_name": "Moderator",
            },
        )
        assert moderator.get(f"/courses/{course}/exam-papers").status_code == 404
        provision(moderator, faculty)
        assert moderator.get(f"/courses/{course}/exam-papers").json()["can_manage"] is True
        paper = create(moderator, course)
        path = f"/exam-papers/{paper['id']}"
        assert moderator.post(path + "/items", json=items(rows[:1])).status_code == 200
        assert moderator.post(path + "/publish").status_code == 200
    assert member.get(path).json()["item_count"] == 1


def test_model_migration_parity():
    with engine.begin() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "compare_server_default": True,
                "include_object": lambda obj, name, type_, reflected, compare_to: (
                    type_ != "table" or name in {"exam_papers", "exam_paper_items"}
                ),
            },
        )
        assert compare_metadata(context, Base.metadata) == []
