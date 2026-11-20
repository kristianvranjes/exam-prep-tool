import os
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.api import auth as auth_api
from app.database import SessionLocal
from app.main import app
from app.models import User

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

CLIENT_ID = "123-test.apps.googleusercontent.com"


@pytest.fixture
def google(monkeypatch):
    """Google sign-in on, the token check replaced: the credential is the claims key."""
    monkeypatch.setenv("GOOGLE_CLIENT_ID", CLIENT_ID)
    tokens: dict[str, dict] = {}

    def verify(credential: str, client_id: str):
        assert client_id == CLIENT_ID
        if credential not in tokens:
            raise auth_api.GoogleTokenError
        return tokens[credential]

    monkeypatch.setattr(auth_api, "verify_with_google", verify)
    return tokens


def claims(email: str, sub: str, **extra):
    return {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": sub,
        "email": email,
        "email_verified": True,
        "name": "Ana Anić",
    } | extra


def test_config_reports_the_methods(monkeypatch):
    with TestClient(app) as client:
        monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
        assert client.get("/auth/config").json() == {
            "google_client_id": None,
            "password_login": True,
        }
        # In development and test the password stays on next to Google unless switched off.
        monkeypatch.setenv("GOOGLE_CLIENT_ID", CLIENT_ID)
        assert client.get("/auth/config").json() == {
            "google_client_id": CLIENT_ID,
            "password_login": True,
        }
        monkeypatch.setenv("PASSWORD_LOGIN_ENABLED", "false")
        assert client.get("/auth/config").json()["password_login"] is False


def test_google_creates_then_finds_the_account(google, monkeypatch):
    email = f"ana-{uuid4().hex}@example.com"
    sub = uuid4().hex
    google["first"] = claims(email.upper(), sub)
    with TestClient(app) as client:
        created = client.post("/auth/google", json={"credential": "first"})
        assert created.status_code == 200, created.text
        assert created.json()["email"] == email and created.json()["display_name"] == "Ana Anić"
        assert client.get("/auth/me").json()["email"] == email
    with TestClient(app) as again:
        google["second"] = claims(email, sub, name="Drugo ime")
        same = again.post("/auth/google", json={"credential": "second"})
        assert same.status_code == 200 and same.json()["id"] == created.json()["id"]
    monkeypatch.delenv("GOOGLE_CLIENT_ID")
    with TestClient(app) as off:
        assert off.post("/auth/google", json={"credential": "first"}).status_code == 404


def test_google_links_an_account_by_email_and_ends_its_older_sessions(google):
    email = f"link-{uuid4().hex}@example.com"
    with TestClient(app) as password:
        registered = password.post(
            "/auth/register",
            json={"email": email, "password": "correct horse", "display_name": "Ana"},
        )
        assert registered.status_code == 201
        assert password.get("/auth/me").status_code == 200
        # Session tokens carry whole seconds; link in a later second than the password session.
        time.sleep(1.1)
        google["link"] = claims(email, uuid4().hex)
        with TestClient(app) as browser:
            linked = browser.post("/auth/google", json={"credential": "link"})
            assert linked.status_code == 200 and linked.json()["id"] == registered.json()["id"]
            assert browser.get("/auth/me").status_code == 200
        # The session opened with the password before linking no longer works.
        assert password.get("/auth/me").status_code == 401
    with TestClient(app) as other:
        google["other"] = claims(email, uuid4().hex)
        assert other.post("/auth/google", json={"credential": "other"}).status_code == 409


def test_google_refuses_bad_tokens_and_disabled_accounts(google):
    email = f"bad-{uuid4().hex}@example.com"
    google["unverified"] = claims(email, uuid4().hex, email_verified=False)
    google["audience"] = claims(email, uuid4().hex, aud="someone-else.apps.googleusercontent.com")
    with TestClient(app) as client:
        assert client.post("/auth/google", json={"credential": "unknown"}).status_code == 401
        assert client.post("/auth/google", json={"credential": "unverified"}).status_code == 401
        assert client.post("/auth/google", json={"credential": "audience"}).status_code == 401
        sub = uuid4().hex
        google["ok"] = claims(email, sub)
        assert client.post("/auth/google", json={"credential": "ok"}).status_code == 200
    with SessionLocal() as db:
        db.execute(update(User).where(User.google_sub == sub).values(is_active=False))
        db.commit()
    with TestClient(app) as client:
        assert client.post("/auth/google", json={"credential": "ok"}).status_code == 403


def test_password_sign_in_can_be_turned_off(monkeypatch):
    monkeypatch.setenv("PASSWORD_LOGIN_ENABLED", "false")
    with TestClient(app) as client:
        body = {
            "email": f"off-{uuid4().hex}@example.com",
            "password": "correct horse",
            "display_name": "X",
        }
        assert client.post("/auth/register", json=body).status_code == 403
        assert client.post("/auth/login", json=body).status_code == 403
