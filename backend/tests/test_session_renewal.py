"""Sliding session renewal through the current-user dependency, without a database."""

import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.auth import router as auth_router
from app.config import Settings
from app.dependencies import get_db
from app.models import User
from app.services.auth import create_session, load_session, session_needs_renewal

MAX_AGE = 14400
SETTINGS = Settings(
    _env_file=None,
    session_secret="a-test-only-random-session-secret-123456789",
    session_max_age_seconds=MAX_AGE,
)
NAME = SETTINGS.session_cookie_name
USER = User(
    id=uuid4(),
    email="student@example.com",
    display_name="Student",
    is_active=True,
    created_at=datetime.now(UTC),
)


class FakeDb:
    def get(self, model: type, key: object) -> User | None:
        return USER if key == USER.id else None


def token_issued(seconds_ago: int) -> str:
    stamp = int(time.time()) - seconds_ago
    with patch("itsdangerous.timed.TimestampSigner.get_timestamp", return_value=stamp):
        return create_session(USER.id, SETTINGS)


def sign_in(client: TestClient, seconds_ago: int) -> str:
    """Store a token as the browser would; TestClient's server cookies use this domain."""
    token = token_issued(seconds_ago)
    client.cookies.set(NAME, token, domain="testserver.local")
    return token


@pytest.fixture
def client() -> Iterator[TestClient]:
    service = FastAPI()
    service.include_router(auth_router)
    service.dependency_overrides[get_db] = lambda: FakeDb()
    with (
        patch("app.dependencies.Settings", return_value=SETTINGS),
        patch("app.api.auth.Settings", return_value=SETTINGS),
        TestClient(service) as test_client,
    ):
        yield test_client


def test_fresh_token_is_not_reissued(client: TestClient) -> None:
    sign_in(client, 60)
    response = client.get("/auth/me")
    assert response.status_code == 200
    assert "set-cookie" not in response.headers


def test_token_past_half_its_lifetime_is_reissued_with_login_attributes(
    client: TestClient,
) -> None:
    old = sign_in(client, MAX_AGE // 2 + 60)
    response = client.get("/auth/me")
    assert response.status_code == 200
    cookie = response.headers["set-cookie"]
    assert all(flag in cookie for flag in ["HttpOnly", "Path=/", f"Max-Age={MAX_AGE}"])
    renewed = response.cookies.get(NAME)
    assert renewed and renewed != old
    session = load_session(renewed, SETTINGS)
    assert session is not None and session[0] == USER.id
    assert datetime.now(UTC) - session[1] < timedelta(seconds=5)


def test_expired_token_is_rejected_without_a_cookie(client: TestClient) -> None:
    sign_in(client, MAX_AGE + 60)
    response = client.get("/auth/me")
    assert response.status_code == 401
    assert "set-cookie" not in response.headers


def test_logout_clears_an_old_token_and_is_not_undone_by_renewal(client: TestClient) -> None:
    sign_in(client, MAX_AGE // 2 + 60)
    response = client.post("/auth/logout")
    assert response.status_code == 204
    cookies = response.headers.get_list("set-cookie")
    assert len(cookies) == 1 and "Max-Age=0" in cookies[0]
    assert not client.cookies.get(NAME)
    assert client.get("/auth/me").status_code == 401


def test_renewal_threshold_is_half_the_max_age() -> None:
    now = datetime.now(UTC)
    assert not session_needs_renewal(now - timedelta(seconds=MAX_AGE // 2 - 1), SETTINGS, now)
    assert session_needs_renewal(now - timedelta(seconds=MAX_AGE // 2), SETTINGS, now)
