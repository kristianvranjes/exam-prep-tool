import os
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete
from test_materials import clients as clients

from app.database import SessionLocal
from app.models.faculty import Faculty
from app.models.faculty_creator import FacultyCreator
from app.services.faculties import slugify

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

PREFIX = "Fakultet elektrotehnike i računarstva"


@pytest.fixture
def fer():
    """A faculty body with a unique name; faculties created by the test are removed after."""
    token = uuid4().hex[:8]
    yield {"name": f"{PREFIX} {token}", "university_name": "Sveučilište u Zagrebu"}
    with SessionLocal() as db:
        db.execute(delete(Faculty).where(Faculty.slug.like(f"%{token}%")))
        db.commit()


def test_slugs_drop_diacritics_and_punctuation():
    assert slugify(PREFIX) == "fakultet-elektrotehnike-i-racunarstva"
    assert slugify("  Đakovo -- Odjel (ADM)  ") == "dakovo-odjel-adm"
    assert slugify("!!!") == ""
    assert len(slugify("x" * 300)) == 100


def test_a_moderator_adds_a_faculty_and_moderates_only_that_one(clients, fer):
    owner, member, _, _ = clients  # the fixture makes the owner moderate the first faculty
    assert owner.get("/faculties/can-create").json() == {"can_create": True}

    response = owner.post("/faculties", json=fer)
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["slug"] == slugify(fer["name"])
    assert created["slug"].startswith("fakultet-elektrotehnike-i-racunarstva-")
    assert created["university_name"] == "Sveučilište u Zagrebu"
    assert created["id"] in {row["id"] for row in member.get("/faculties").json()}

    status = owner.get(f"/faculties/{created['id']}/moderator-status").json()
    assert status == {"is_moderator": True}
    assert member.get(f"/faculties/{created['id']}/moderator-status").json() == {
        "is_moderator": False
    }
    owner_id = UUID(owner.get("/auth/me").json()["id"])
    with SessionLocal() as db:
        assert db.get(FacultyCreator, UUID(created["id"])).user_id == owner_id


def test_students_cannot_add_faculties(clients, fer):
    _, member, stranger, _ = clients
    for client in (member, stranger):
        assert client.get("/faculties/can-create").json() == {"can_create": False}
        assert client.post("/faculties", json=fer).status_code == 403


def test_moderating_only_an_inactive_faculty_is_not_enough(clients, fer):
    owner, _, _, _ = clients
    first = owner.get("/faculties").json()[0]["id"]
    with SessionLocal() as db:
        db.get(Faculty, UUID(first)).is_active = False
        db.commit()
    try:
        assert owner.get("/faculties/can-create").json() == {"can_create": False}
        assert owner.post("/faculties", json=fer).status_code == 403
    finally:
        with SessionLocal() as db:
            db.get(Faculty, UUID(first)).is_active = True
            db.commit()


@pytest.mark.parametrize(
    ("body", "status"),
    [
        ({"name": ""}, 422),
        ({"name": "   "}, 422),
        ({"name": "x" * 151}, 422),
        ({"name": "!!!"}, 422),
        ({"name": "Pravo", "slug": "Ima Razmak"}, 422),
        ({"name": "Pravo", "university_name": "x" * 201}, 422),
        ({"name": "Pravo", "is_active": False}, 422),
    ],
)
def test_invalid_faculties_are_refused(clients, body, status):
    owner, _, _, _ = clients
    assert owner.post("/faculties", json=body).status_code == status


def test_a_taken_address_is_a_conflict(clients, fer):
    owner, _, _, _ = clients
    assert owner.post("/faculties", json=fer).status_code == 201
    again = owner.post("/faculties", json={"name": "FER", "slug": slugify(fer["name"])})
    assert again.status_code == 409
    assert again.json()["detail"] == "A faculty with this address already exists"
    with SessionLocal() as db:
        slugs = [f.slug for f in db.query(Faculty).all()]
    assert slugs.count(slugify(fer["name"])) == 1
