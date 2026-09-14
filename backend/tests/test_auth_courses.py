import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import engine
from app.main import app

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

        created = client.post(
            "/courses", json={"name": "Algorithms", "code": "ALG101", "description": "Core course"}
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
        assert client.delete(f"/courses/{course_id}").status_code == 204


def test_bad_login_and_non_owner_cannot_manage_course() -> None:
    with TestClient(app) as owner, TestClient(app) as member:
        owner.post(
            "/auth/register",
            json={
                "email": "owner@example.com",
                "password": "correct horse",
                "display_name": "Owner",
            },
        )
        course = owner.post("/courses", json={"name": "Private"}).json()
        bad_login = member.post(
            "/auth/login", json={"email": "owner@example.com", "password": "wrong password"}
        )
        assert bad_login.status_code == 401
        member.post(
            "/auth/register",
            json={
                "email": "member@example.com",
                "password": "correct horse",
                "display_name": "Member",
            },
        )
        assert member.get(f"/courses/{course['id']}").status_code == 404
