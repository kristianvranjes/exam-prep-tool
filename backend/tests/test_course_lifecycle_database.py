"""Archiving, restoring and deleting courses and faculties (issue #176)."""

import os
from uuid import UUID, uuid4

import pytest
from community_helpers import archive_course, create_course, delete_course, provision
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from test_materials import clients as clients

from app.database import SessionLocal
from app.main import app
from app.models import Course
from app.models.faculty import Faculty
from app.models.faculty_moderator import FacultyModerator

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


@pytest.fixture
def made():
    """Faculties made by a test; they sort last so `GET /faculties` [0] stays the same."""
    token = uuid4().hex[:8]
    ids: list[UUID] = []

    def faculty(name="Zz fakultet", **kwargs):
        with SessionLocal() as db:
            row = Faculty(name=f"{name} {token}", slug=f"zz-{token}-{len(ids)}", **kwargs)
            db.add(row)
            db.commit()
            ids.append(row.id)
            return row.id

    yield faculty
    with SessionLocal() as db:
        db.execute(delete(Course).where(Course.faculty_id.in_(ids)))
        db.execute(delete(Faculty).where(Faculty.slug.like(f"zz-{token}-%")))
        db.commit()


def person(name):
    client = TestClient(app)
    email = f"{name}-{uuid4().hex}@example.com"
    response = client.post(
        "/auth/register",
        json={"email": email, "password": "correct horse", "display_name": name},
    )
    assert response.status_code == 201
    return client


def faculty_of(course_id):
    with SessionLocal() as db:
        return db.get(Course, UUID(course_id)).faculty_id


def catalog_ids(client, faculty_id):
    return [row["id"] for row in client.get(f"/faculties/{faculty_id}/courses").json()]


def test_archive_hides_from_catalog_and_enrolment_but_members_keep_the_course(clients):
    owner, member, stranger, course = clients
    faculty = faculty_of(course)
    assert course in catalog_ids(stranger, faculty)

    archived = owner.post(f"/courses/{course}/archive")
    assert archived.status_code == 200 and archived.json()["is_active"] is False
    assert owner.post(f"/courses/{course}/archive").json()["is_active"] is False  # idempotent
    assert course not in catalog_ids(stranger, faculty)
    assert stranger.post(f"/courses/{course}/join").status_code == 404
    assert stranger.get(f"/courses/{course}").status_code == 404
    # Members still read the course, its membership and their list.
    assert member.get(f"/courses/{course}").json()["is_active"] is False
    assert member.get(f"/courses/{course}/membership").status_code == 200
    listed = {row["id"]: row for row in member.get("/courses").json()}
    assert listed[course]["is_active"] is False
    assert member.get(f"/courses/{course}/review-progress").status_code == 200

    restored = owner.post(f"/courses/{course}/restore")
    assert restored.status_code == 200 and restored.json()["is_active"] is True
    assert course in catalog_ids(stranger, faculty)
    assert stranger.post(f"/courses/{course}/join").status_code == 200


@pytest.mark.parametrize("action", ["archive", "restore", "delete"])
def test_course_lifecycle_permissions(clients, made, action):
    owner, member, stranger, course = clients
    faculty = faculty_of(course)
    moderator = person("moderator")
    provision(moderator, faculty)
    elsewhere = person("elsewhere")
    provision(elsewhere, made())
    joined_elsewhere = person("joined-elsewhere")
    provision(joined_elsewhere, made())
    assert joined_elsewhere.post(f"/courses/{course}/join").status_code == 200
    archive_course(owner, course)

    def call(client):
        if action == "delete":
            return client.delete(f"/courses/{course}", params={"confirm_name": "Materials"})
        return client.post(f"/courses/{course}/{action}")

    with TestClient(app) as anonymous:
        assert call(anonymous).status_code == 401
    assert call(stranger).status_code == 404
    assert call(elsewhere).status_code == 404  # moderating another faculty is no access
    assert call(member).status_code == 403
    assert call(joined_elsewhere).status_code == 403
    with SessionLocal() as db:
        assert db.get(Course, UUID(course)).is_active is False
    # A moderator of the course's faculty need not have joined the course.
    assert call(moderator).status_code == (204 if action == "delete" else 200)


@pytest.mark.parametrize("action", ["archive", "delete"])
def test_owner_without_moderator_rights_manages_the_course(clients, action):
    owner, _, _, course = clients
    owner_id = UUID(owner.get("/auth/me").json()["id"])
    with SessionLocal() as db:
        db.execute(delete(FacultyModerator).where(FacultyModerator.user_id == owner_id))
        db.commit()
    if action == "archive":
        assert owner.post(f"/courses/{course}/archive").status_code == 200
        assert owner.post(f"/courses/{course}/restore").status_code == 200
    else:
        assert delete_course(owner, course).status_code == 204
        with SessionLocal() as db:
            assert db.get(Course, UUID(course)) is None


def test_delete_needs_an_archived_course_and_its_exact_name(clients):
    owner, member, _, course = clients
    path = f"/courses/{course}"
    # A course that is not archived is a conflict, even with the right name.
    response = owner.delete(path, params={"confirm_name": "Materials"})
    assert response.status_code == 409
    assert response.json()["detail"] == "Archive the course before deleting it"
    archive_course(owner, course)
    for params in ({}, {"confirm_name": ""}, {"confirm_name": "materials"}, {"confirm_name": "M"}):
        response = owner.delete(path, params=params)
        assert response.status_code == 422, params
        assert response.json()["detail"] == "Type the course name to confirm deletion"
    assert member.delete(path, params={"confirm_name": "Materials"}).status_code == 403
    assert member.get(path).status_code == 200
    # Surrounding spaces are trimmed; the name itself must match exactly.
    assert owner.delete(path, params={"confirm_name": "  Materials "}).status_code == 204
    assert member.get(path).status_code == 404
    assert owner.delete(path, params={"confirm_name": "Materials"}).status_code == 404


def test_faculty_tools_are_only_for_moderators_of_that_faculty(clients, made):
    owner, member, stranger, _ = clients
    faculty = made()
    other = made("Zz drugi")
    provision(owner, other)  # the owner moderates another faculty, not this one
    for client in (member, stranger, owner):
        assert client.patch(f"/faculties/{faculty}", json={"name": "Novo"}).status_code == 403
        assert client.post(f"/faculties/{faculty}/archive").status_code == 403
        assert client.post(f"/faculties/{faculty}/restore").status_code == 403
        assert client.delete(f"/faculties/{faculty}").status_code == 403
        assert str(faculty) not in {row["id"] for row in client.get("/faculties/manage").json()}
    # A faculty that does not exist reads the same, so the answer says nothing about it.
    assert owner.delete(f"/faculties/{uuid4()}").status_code == 403
    assert member.get("/faculties/manage").json() == []
    with TestClient(app) as anonymous:
        assert anonymous.get("/faculties/manage").status_code == 401
        assert anonymous.delete(f"/faculties/{faculty}").status_code == 401
    with SessionLocal() as db:
        row = db.get(Faculty, faculty)
        assert row.is_active and row.name.startswith("Zz fakultet")


def test_faculty_edit_archive_restore_and_delete(clients, made):
    owner, member, stranger, _ = clients
    faculty = made(university_name="Sveučilište")
    path = f"/faculties/{faculty}"
    with SessionLocal() as db:
        slug = db.get(Faculty, faculty).slug
    provision(owner, faculty)
    assert owner.patch(f"/faculties/{uuid4()}", json={"name": "X"}).status_code == 403
    assert owner.post(f"/faculties/{uuid4()}/archive").status_code == 403
    assert owner.patch(path, json={"name": "  "}).status_code == 422
    assert owner.patch(path, json={"name": None}).status_code == 422
    assert owner.patch(path, json={"slug": "novi"}).status_code == 422

    edited = owner.patch(path, json={"name": "Zz Novi naziv", "university_name": None})
    assert edited.status_code == 200, edited.text
    assert edited.json() | {"id": None} == {
        "id": None,
        "name": "Zz Novi naziv",
        "slug": slug,
        "university_name": None,
        "is_active": True,
        "course_count": 0,
    }

    course = create_course(owner, json={"name": "Arhiva", "faculty_id": str(faculty)}).json()
    assert member.post(f"/courses/{course['id']}/join").status_code == 200

    # Delete refuses an active faculty, then one that still has a course, archived or not.
    assert owner.delete(path).status_code == 409
    archived = owner.post(f"{path}/archive")
    assert archived.status_code == 200
    assert archived.json()["is_active"] is False and archived.json()["course_count"] == 1
    assert str(faculty) not in {row["id"] for row in stranger.get("/faculties").json()}
    assert stranger.get(f"{path}/courses").status_code == 404
    assert stranger.post(f"/courses/{course['id']}/join").status_code == 404
    new_course = {"name": "Nova", "faculty_id": str(faculty)}
    assert owner.post("/courses", json=new_course).status_code == 404
    # The faculty's courses and members are untouched.
    assert member.get(f"/courses/{course['id']}").json()["is_active"] is True
    managed = {row["id"]: row for row in owner.get("/faculties/manage").json()}
    assert managed[str(faculty)]["is_active"] is False
    assert managed[str(faculty)]["course_count"] == 1
    archive_course(owner, course["id"])
    response = owner.delete(path)
    assert response.status_code == 409
    assert response.json()["detail"] == "A faculty with courses cannot be deleted"

    assert owner.post(f"{path}/restore").json()["is_active"] is True
    assert str(faculty) in {row["id"] for row in stranger.get("/faculties").json()}
    assert delete_course(owner, course["id"], course["name"]).status_code == 204
    assert owner.delete(path).status_code == 409  # restored, so active again
    assert owner.post(f"{path}/archive").status_code == 200
    assert owner.delete(path).status_code == 204
    # Its moderator rows went with it, so the same call is now refused rather than "not found".
    assert owner.delete(path).status_code == 403
    with SessionLocal() as db:
        assert db.get(Faculty, faculty) is None
        assert (
            db.scalars(select(FacultyModerator).where(FacultyModerator.faculty_id == faculty)).all()
            == []
        )


def test_a_moderator_can_restore_the_faculty_they_archived(clients, made):
    owner, _, stranger, _ = clients
    faculty = made()
    provision(owner, faculty)
    assert owner.post(f"/faculties/{faculty}/archive").status_code == 200
    # An archived faculty stays in the moderator's own list, so they can bring it back.
    listed = {row["id"]: row for row in owner.get("/faculties/manage").json()}
    assert listed[str(faculty)]["is_active"] is False
    assert stranger.post(f"/faculties/{faculty}/restore").status_code == 403
    assert owner.post(f"/faculties/{faculty}/restore").json()["is_active"] is True


def test_a_moderator_deletes_a_faculty_with_all_its_courses(clients, made):
    owner, member, stranger, _ = clients
    faculty = made()
    provision(owner, faculty)
    with SessionLocal() as db:
        name = db.get(Faculty, faculty).name
    active = create_course(owner, json={"name": "Aktivan", "faculty_id": str(faculty)}).json()
    archived = create_course(owner, json={"name": "Arhiviran", "faculty_id": str(faculty)}).json()
    archive_course(owner, archived["id"])
    assert member.post(f"/courses/{active['id']}/join").status_code == 200
    path = f"/faculties/{faculty}"
    # Without the option the old rule stands: an active faculty with courses stays.
    assert owner.delete(path).status_code == 409
    params = {"with_courses": "true", "confirm_name": name}
    assert member.delete(path, params=params).status_code == 403
    assert (
        owner.delete(path, params={"with_courses": "true", "confirm_name": "kriv"}).status_code
        == 422
    )
    assert owner.delete(path, params={"with_courses": "true"}).status_code == 422
    with SessionLocal() as db:
        assert db.get(Faculty, faculty) is not None
    deleted = owner.delete(path, params={"with_courses": "true", "confirm_name": f"  {name} "})
    assert deleted.status_code == 204, deleted.text
    with SessionLocal() as db:
        assert db.get(Faculty, faculty) is None
        assert db.scalars(select(Course).where(Course.faculty_id == faculty)).all() == []
    assert member.get(f"/courses/{active['id']}").status_code == 404
    assert all(row["id"] != active["id"] for row in member.get("/courses").json())
