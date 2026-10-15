import os
from uuid import UUID, uuid4

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from community_helpers import create_course, review_question
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from test_materials import clients as clients
from test_quiz_import import document

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models.course_unit import CourseUnit, QuestionUnit
from app.models.faculty_moderator import FacultyModerator
from app.models.question import Question, QuestionVersion

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def question(stem: str, unit_ids: list[str] | None = None) -> dict[str, object]:
    return {
        "type": "TRUE_FALSE",
        "stem": stem,
        "explanation": "Private explanation",
        "correct_answer": True,
        "unit_ids": unit_ids or [],
    }


def unit(client, course: str, title: str) -> str:
    response = client.post(f"/courses/{course}/units", json={"title": title})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def titles(client, course: str, *, include_archived: bool = False) -> list[str]:
    path = f"/courses/{course}/units?include_archived={str(include_archived).lower()}"
    return [row["title"] for row in client.get(path).json()]


def version_count(question_id: str) -> int:
    with SessionLocal() as db:
        return (
            db.scalar(
                select(func.count())
                .select_from(QuestionVersion)
                .where(QuestionVersion.question_id == UUID(question_id))
            )
            or 0
        )


def approve(creator, question_id: str) -> None:
    assert creator.post(f"/questions/{question_id}/submit").status_code == 200
    approved = review_question(creator, f"/questions/{question_id}/approve")
    assert approved.json()["status"] == "APPROVED", approved.text


def test_unit_management_permissions_order_and_archive(clients):
    owner, member, stranger, course = clients
    path = f"/courses/{course}/units"
    with TestClient(app) as anonymous:
        assert anonymous.get(path).status_code == 401
    assert stranger.get(path).status_code == 404
    assert member.get(path).json() == []
    assert member.post(path, json={"title": "Uvod"}).status_code == 403
    assert stranger.post(path, json={"title": "Uvod"}).status_code == 404

    created = owner.post(path, json={"title": "  Uvod  ", "description": "Osnovni pojmovi"})
    assert created.status_code == 201, created.text
    first = created.json()
    assert first["title"] == "Uvod" and first["position"] == 0
    assert first["is_archived"] is False and first["approved_question_count"] == 0
    second = unit(owner, course, "Logika sudova")
    third = unit(owner, course, "Skupovi")
    assert owner.post(path, json={"title": "uvod"}).status_code == 409
    assert owner.post(path, json={"title": "   "}).status_code == 422
    assert owner.post(path, json={"title": "x" * 151}).status_code == 422
    assert owner.post(path, json={"title": "Extra", "position": 0}).status_code == 422
    assert titles(member, course) == ["Uvod", "Logika sudova", "Skupovi"]

    unit_path = f"/units/{first['id']}"
    assert member.patch(unit_path, json={"title": "Nope"}).status_code == 403
    assert stranger.patch(unit_path, json={"title": "Nope"}).status_code == 404
    assert owner.patch(f"/units/{uuid4()}", json={"title": "Nope"}).status_code == 404
    assert owner.patch(unit_path, json={}).status_code == 422
    assert owner.patch(unit_path, json={"title": None}).status_code == 422
    assert owner.patch(unit_path, json={"title": "Skupovi"}).status_code == 409
    renamed = owner.patch(unit_path, json={"title": "Uvod u logiku"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["description"] == "Osnovni pojmovi"
    cleared = owner.patch(unit_path, json={"description": None})
    assert cleared.json()["description"] is None and cleared.json()["title"] == "Uvod u logiku"

    order = f"/courses/{course}/units/order"
    assert member.patch(order, json={"unit_ids": [third, second, first["id"]]}).status_code == 403
    assert owner.patch(order, json={"unit_ids": [third, second]}).status_code == 422
    assert owner.patch(order, json={"unit_ids": [third, third, second]}).status_code == 422
    assert owner.patch(order, json={"unit_ids": [third, second, str(uuid4())]}).status_code == 422
    reordered = owner.patch(order, json={"unit_ids": [third, first["id"], second]})
    assert reordered.status_code == 200, reordered.text
    assert [(row["title"], row["position"]) for row in reordered.json()] == [
        ("Skupovi", 0),
        ("Uvod u logiku", 1),
        ("Logika sudova", 2),
    ]

    assert member.post(f"/units/{third}/archive").status_code == 403
    archived = owner.post(f"/units/{third}/archive")
    assert archived.status_code == 200 and archived.json()["is_archived"] is True
    assert titles(member, course) == ["Uvod u logiku", "Logika sudova"]
    assert titles(owner, course, include_archived=True) == [
        "Skupovi",
        "Uvod u logiku",
        "Logika sudova",
    ]
    # Reordering lists active units only; archived units follow them.
    assert owner.patch(order, json={"unit_ids": [third, second, first["id"]]}).status_code == 422
    after = owner.patch(order, json={"unit_ids": [second, first["id"]]}).json()
    assert [(row["title"], row["is_archived"]) for row in after] == [
        ("Logika sudova", False),
        ("Uvod u logiku", False),
        ("Skupovi", True),
    ]
    restored = owner.post(f"/units/{third}/restore")
    assert restored.status_code == 200 and restored.json()["is_archived"] is False
    assert titles(member, course) == ["Logika sudova", "Uvod u logiku", "Skupovi"]


def test_question_links_filters_and_reorganization(clients):
    owner, member, stranger, course = clients
    first = unit(owner, course, "Cjelina 1")
    second = unit(owner, course, "Cjelina 2")
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    other_course = create_course(owner, json={"name": "Other", "faculty_id": faculty}).json()["id"]
    foreign = unit(owner, other_course, "Foreign")
    path = f"/courses/{course}/questions"

    assert member.post(path, json=question("Foreign?", [foreign])).status_code == 422
    assert member.post(path, json=question("Duplicate?", [first, first])).status_code == 422
    assert member.post(path, json=question("Unknown?", [str(uuid4())])).status_code == 422
    too_many = [str(uuid4()) for _ in range(6)]
    assert member.post(path, json=question("Too many?", too_many)).status_code == 422
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Question)) == 0

    created = member.post(path, json=question("Is P or not P a tautology?", [first]))
    assert created.status_code == 201, created.text
    linked = created.json()
    assert linked["unit_ids"] == [first]
    versions = member.get(f"/questions/{linked['id']}/versions").json()
    assert versions[0]["snapshot"]["unit_ids"] == [first]
    loose = member.post(path, json=question("Is every set finite?")).json()
    assert loose["unit_ids"] == []

    # A patch may change only units, and it versions the draft like other edits.
    edited = member.patch(f"/questions/{loose['id']}", json={"unit_ids": [second]})
    assert edited.status_code == 200, edited.text
    assert edited.json()["unit_ids"] == [second]
    assert member.patch(f"/questions/{loose['id']}", json={"unit_ids": None}).status_code == 422
    assert (
        member.patch(f"/questions/{loose['id']}", json={"unit_ids": [foreign]}).status_code == 422
    )
    assert member.patch(f"/questions/{loose['id']}", json={"unit_ids": []}).json()["unit_ids"] == []

    # Archived units reject new links but stay on questions that already have them.
    assert owner.post(f"/units/{first}/archive").status_code == 200
    assert member.post(path, json=question("New link?", [first])).status_code == 422
    kept = member.patch(f"/questions/{linked['id']}", json={"stem": "Is P or not P valid?"})
    assert kept.status_code == 200 and kept.json()["unit_ids"] == [first]
    resent = member.patch(f"/questions/{linked['id']}", json={"unit_ids": [first, second]})
    assert resent.status_code == 200 and resent.json()["unit_ids"] == sorted([first, second])
    assert owner.post(f"/units/{first}/restore").status_code == 200

    approve(member, linked["id"])
    with TestClient(app) as peer:
        assert (
            peer.post(
                "/auth/register",
                json={
                    "email": "peer@example.com",
                    "password": "correct horse",
                    "display_name": "P",
                },
            ).status_code
            == 201
        )
        assert peer.post(f"/courses/{course}/join").status_code == 200
        public = peer.get(f"/questions/{linked['id']}").json()
        assert public["visibility"] == "MEMBER"
        assert public["unit_ids"] == sorted([first, second])
        assert "explanation" not in public
        filtered = peer.get(f"{path}?unit_id={first}").json()
        assert [row["id"] for row in filtered] == [linked["id"]]
        assert peer.get(f"{path}?unassigned=true").json() == []
        assert (
            peer.patch(f"/questions/{linked['id']}/units", json={"unit_ids": []}).status_code == 403
        )

    counts = {
        row["id"]: row["approved_question_count"]
        for row in member.get(f"/courses/{course}/units").json()
    }
    assert counts == {first: 1, second: 1}
    assert [row["id"] for row in member.get(f"{path}?unassigned=true").json()] == [loose["id"]]
    assert member.get(f"{path}?unit_id={first}&unassigned=true").status_code == 422
    assert member.get(f"{path}?unit_id={foreign}").json() == []

    # Owners and moderators reorganize approved questions without a new version or review.
    units_path = f"/questions/{linked['id']}/units"
    before = version_count(linked["id"])
    assert member.patch(units_path, json={"unit_ids": [second]}).status_code == 403
    assert stranger.patch(units_path, json={"unit_ids": [second]}).status_code == 404
    assert owner.patch(units_path, json={"unit_ids": [foreign]}).status_code == 422
    assert owner.patch(units_path, json={"unit_ids": [second, second]}).status_code == 422
    moved = owner.patch(units_path, json={"unit_ids": [second]})
    assert moved.status_code == 200, moved.text
    assert moved.json()["unit_ids"] == [second] and moved.json()["status"] == "APPROVED"
    assert version_count(linked["id"]) == before
    counts = {
        row["id"]: row["approved_question_count"]
        for row in member.get(f"/courses/{course}/units").json()
    }
    assert counts == {first: 0, second: 1}

    # Creators may reorganize their own drafts through the same endpoint.
    draft_units = member.patch(f"/questions/{loose['id']}/units", json={"unit_ids": [first]})
    assert draft_units.status_code == 200 and draft_units.json()["unit_ids"] == [first]

    assert owner.post(f"/questions/{linked['id']}/archive").status_code == 200
    assert owner.patch(units_path, json={"unit_ids": []}).status_code == 409


def test_import_applies_selected_units_atomically(clients):
    owner, member, _, course = clients
    first = unit(owner, course, "Cjelina 1")
    archived = unit(owner, course, "Stara cjelina")
    assert owner.post(f"/units/{archived}/archive").status_code == 200
    path = f"/courses/{course}/questions/import"

    rejected = member.post(f"{path}?unit_ids={archived}", json=document())
    assert rejected.status_code == 422
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Question)) == 0

    imported = member.post(f"{path}?unit_ids={first}", json=document())
    assert imported.status_code == 201, imported.text
    assert {tuple(row["unit_ids"]) for row in imported.json()} == {(first,)}
    plain = owner.post(path, json=document())
    assert plain.status_code == 201 and all(row["unit_ids"] == [] for row in plain.json())


def test_bulk_unit_assignment_is_atomic_and_manager_only(clients):
    owner, member, stranger, course = clients
    first, second, third, fourth, fifth, sixth = (
        unit(owner, course, f"Cjelina {n}") for n in range(1, 7)
    )
    faculty = owner.get(f"/courses/{course}").json()["faculty_id"]
    other_course = create_course(owner, json={"name": "Other", "faculty_id": faculty}).json()["id"]
    foreign = unit(owner, other_course, "Foreign")
    elsewhere = owner.post(f"/courses/{other_course}/questions", json=question("Elsewhere?")).json()
    path = f"/courses/{course}/questions"
    linked = member.post(path, json=question("Is P or not P valid?", [first])).json()
    loose = member.post(path, json=question("Is every set finite?")).json()
    full = member.post(
        path, json=question("Is the empty set finite?", [second, third, fourth, fifth, sixth])
    ).json()
    draft = member.post(path, json=question("Private draft?")).json()
    for row in (linked, loose, full):
        approve(member, row["id"])
    bulk = f"/courses/{course}/questions/units"

    def body(ids, unit_id, action="ADD"):
        return {"question_ids": [row["id"] for row in ids], "unit_id": unit_id, "action": action}

    def units_of(row):
        return member.get(f"/questions/{row['id']}").json()["unit_ids"]

    # Only owners and moderators reorganize; strangers do not learn the course exists.
    assert member.post(bulk, json=body([loose], first)).status_code == 403
    assert stranger.post(bulk, json=body([loose], first)).status_code == 404
    duplicate = {"question_ids": [loose["id"], loose["id"]], "unit_id": first, "action": "ADD"}
    assert owner.post(bulk, json=duplicate).status_code == 422
    assert owner.post(bulk, json=body([loose], first, "MOVE")).status_code == 422
    assert owner.post(bulk, json=body([loose], foreign)).status_code == 422
    # Any unknown, foreign-course, or over-limit question rejects the whole request.
    assert owner.post(bulk, json=body([loose, {"id": str(uuid4())}], first)).status_code == 404
    assert owner.post(bulk, json=body([loose, elsewhere], first)).status_code == 404
    assert owner.post(bulk, json=body([loose, full], first)).status_code == 422
    assert units_of(loose) == [] and units_of(full) == sorted([second, third, fourth, fifth, sixth])

    before = version_count(loose["id"])
    added = owner.post(bulk, json=body([linked, loose, draft], first))
    assert added.status_code == 200, added.text
    assert added.json() == {"changed": 2, "unchanged": 1}
    assert units_of(loose) == [first] and units_of(draft) == [first]
    assert version_count(loose["id"]) == before
    assert member.get(f"/questions/{loose['id']}").json()["status"] == "APPROVED"

    # Archived units take no new links but can still be removed in bulk.
    assert owner.post(f"/units/{second}/archive").status_code == 200
    assert owner.post(bulk, json=body([loose], second)).status_code == 422
    removed = owner.post(bulk, json=body([loose, full], second, "REMOVE"))
    assert removed.json() == {"changed": 1, "unchanged": 1}
    assert units_of(full) == sorted([third, fourth, fifth, sixth])

    archived = review_question(member, f"/questions/{loose['id']}/archive")
    assert archived.status_code == 200, archived.text
    assert owner.post(bulk, json=body([linked, loose], third)).status_code == 409
    assert third not in units_of(linked)

    # A course owner who is not a moderator cannot see, so cannot organize, others' drafts.
    with SessionLocal() as db:
        owner_id = UUID(owner.get("/auth/me").json()["id"])
        db.query(FacultyModerator).filter_by(user_id=owner_id).delete()
        db.commit()
    assert owner.post(bulk, json=body([linked, draft], first, "REMOVE")).status_code == 404
    kept = owner.post(bulk, json=body([linked], first, "REMOVE"))
    assert kept.status_code == 200 and units_of(linked) == [] and units_of(draft) == [first]


def test_course_delete_removes_units_and_links(clients):
    owner, member, _, course = clients
    first = unit(owner, course, "Cjelina 1")
    assert (
        member.post(f"/courses/{course}/questions", json=question("Linked?", [first])).status_code
        == 201
    )
    assert owner.delete(f"/courses/{course}").status_code == 204
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(CourseUnit)) == 0
        assert db.scalar(select(func.count()).select_from(QuestionUnit)) == 0


def test_model_migration_parity():
    with engine.begin() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "compare_server_default": True,
                "include_object": lambda obj, name, type_, reflected, compare_to: (
                    type_ != "table" or name in {"course_units", "question_units"}
                ),
            },
        )
        assert compare_metadata(context, Base.metadata) == []
