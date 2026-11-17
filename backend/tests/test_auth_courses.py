import os
from uuid import UUID

import pytest
from community_helpers import create_course, delete_course
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import SessionLocal, engine
from app.main import app
from app.models import CourseMembership, MembershipRole

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_DB_TESTS") != "1", reason="Set RUN_DB_TESTS=1 with PostgreSQL"
)


@pytest.fixture(autouse=True)
def clean_database():
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE course_memberships, courses, users CASCADE"))
    yield


def test_auth_and_course_authorization() -> None:
    with TestClient(app) as client:
        unauthenticated = client.get("/auth/me")
        assert unauthenticated.status_code == 401

        registration = client.post(
            "/auth/register",
            json={
                "email": "Student@Example.com",
                "password": "correct horse",
                "display_name": "Student",
            },
        )
        assert registration.status_code == 201
        assert registration.json()["email"] == "student@example.com"
        assert "password_hash" not in registration.json()
        assert registration.cookies.get("examprep_session")
        assert client.get("/auth/me").status_code == 200

        duplicate = client.post(
            "/auth/register",
            json={
                "email": "student@example.com",
                "password": "another password",
                "display_name": "Other",
            },
        )
        assert duplicate.status_code == 409

        created = create_course(
            client,
            json={
                "name": "Algorithms",
                "code": "ALG101",
                "description": "Core course",
                "faculty_id": client.get("/faculties").json()[0]["id"],
            },
        )
        assert created.status_code == 201
        course_id = created.json()["id"]
        assert client.get("/courses").json()[0]["id"] == course_id
        membership = client.get(f"/courses/{course_id}/membership")
        assert membership.json()["role"] == "OWNER"

        client.post("/auth/logout")
        assert client.get("/auth/me").status_code == 401

        login = client.post(
            "/auth/login", json={"email": "STUDENT@example.com", "password": "correct horse"}
        )
        assert login.status_code == 200
        assert (
            client.patch(f"/courses/{course_id}", json={"name": "Algorithms 2"}).status_code == 200
        )
        assert delete_course(client, course_id).status_code == 204


def test_bad_login_and_non_owner_cannot_manage_course() -> None:
    with TestClient(app) as owner, TestClient(app) as member, TestClient(app) as unrelated:
        owner.post(
            "/auth/register",
            json={
                "email": "owner@example.com",
                "password": "correct horse",
                "display_name": "Owner",
            },
        )
        course = create_course(
            owner,
            json={"name": "Private", "faculty_id": owner.get("/faculties").json()[0]["id"]},
        ).json()
        path = f"/courses/{course['id']}"
        assert owner.get(f"{path}/membership").json()["role"] == "OWNER"
        bad_login = member.post(
            "/auth/login", json={"email": "owner@example.com", "password": "wrong password"}
        )
        assert bad_login.status_code == 401
        registration = member.post(
            "/auth/register",
            json={
                "email": "member@example.com",
                "password": "correct horse",
                "display_name": "Member",
            },
        )
        assert registration.status_code == 201
        with SessionLocal() as db:
            membership = CourseMembership(
                course_id=UUID(course["id"]),
                user_id=UUID(registration.json()["id"]),
                role=MembershipRole.MEMBER.value,
            )
            db.add(membership)
            db.commit()
            membership_id = membership.id

        assert member.get(path).status_code == 200
        assert member.patch(path, json={"name": "Forbidden"}).status_code == 403
        assert member.delete(path).status_code == 403
        assert owner.get(path).json()["name"] == "Private"

        assert (
            unrelated.post(
                "/auth/register",
                json={
                    "email": "unrelated@example.com",
                    "password": "correct horse",
                    "display_name": "Unrelated",
                },
            ).status_code
            == 201
        )
        assert unrelated.get(path).status_code == 404
        assert unrelated.patch(path, json={"name": "Forbidden"}).status_code == 404
        assert unrelated.delete(path).status_code == 404

        # Ownership is determined by membership, independently of who created the course.
        with SessionLocal() as db:
            membership = db.get(CourseMembership, membership_id)
            assert membership is not None
            membership.role = MembershipRole.OWNER.value
            db.commit()
        assert member.patch(path, json={"name": "Allowed"}).status_code == 200
        assert delete_course(member, course["id"]).status_code == 204
