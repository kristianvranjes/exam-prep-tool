from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.auth import router
from app.auth_limit import AuthRequestLimit
from app.config import Settings
from app.dependencies import get_db
from app.models import User
from app.origin_guard import OriginGuard
from app.services.auth_rate_limit import AuthRateLimiter


def settings(**changes):
    return Settings(
        _env_file=None,
        **(
            dict(app_env="development", auth_rate_limit_mode="enabled", auth_login_max_attempts=2)
            | changes
        ),
    )


def service(config, clock):
    app = FastAPI()
    db = MagicMock()
    db.scalar.return_value = None
    app.dependency_overrides[get_db] = lambda: db
    app.include_router(router)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    app.add_middleware(AuthRequestLimit, settings=config)
    app.add_middleware(OriginGuard, origin=config.frontend_url, enabled=True)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[config.frontend_url],
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
        expose_headers=["Retry-After"],
    )
    # Inject a deterministic clock without sleeping or touching a real database.
    with patch("app.auth_limit.AuthRateLimiter", return_value=AuthRateLimiter(config, clock)):
        app.middleware_stack = app.build_middleware_stack()
    return app, db


def test_independent_client_and_endpoint_budgets_reset_at_boundary():
    now = [0.0]
    limiter = AuthRateLimiter(settings(), clock=lambda: now[0])
    assert limiter.check("/auth/login", "first") is None
    assert limiter.check("/auth/login", "first") is None
    now[0] = 59.1
    assert limiter.check("/auth/login", "first") == 1
    assert limiter.check("/auth/login", "second") is None
    assert limiter.check("/auth/register", "first") is None
    now[0] = 60.0
    assert limiter.check("/auth/login", "first") is None
    for _ in range(4):
        assert limiter.check("/auth/register", "first") is None
    assert limiter.check("/auth/register", "first") == 600
    now[0] = 659.1
    assert limiter.check("/auth/register", "first") is None


def test_global_limit_rejects_rotating_clients_and_recovers():
    now = [0.0]
    limiter = AuthRateLimiter(settings(auth_login_max_total_attempts=3), clock=lambda: now[0])
    for client in ("first", "second", "third"):
        assert limiter.check("/auth/login", client) is None
    for number in range(100):
        assert limiter.check("/auth/login", f"new-{number}") == 60
    now[0] = 60
    assert limiter.check("/auth/login", "fourth") is None


def test_simultaneous_attempts_cannot_exceed_budget():
    limiter = AuthRateLimiter(settings(auth_login_max_total_attempts=7), clock=lambda: 0.0)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(
            pool.map(lambda number: limiter.check("/auth/login", str(number)), range(40))
        )
    assert results.count(None) == 7
    assert results.count(60) == 33


def test_real_login_rejects_before_db_and_hashing_and_recovers_without_new_cookie():
    now = [0.0]
    config = settings()
    app, db = service(config, lambda: now[0])
    db.scalar.return_value = User(
        id=uuid4(),
        email="student@example.com",
        display_name="Student",
        password_hash="fake-hash",
        is_active=True,
        created_at=datetime.now(UTC),
    )
    body = {"email": "student@example.com", "password": "correct horse"}
    headers = {"Origin": config.frontend_url}
    with (
        patch("app.api.auth.verify_password", return_value=True) as verify,
        patch("app.api.auth.Settings", return_value=config),
        TestClient(app) as client,
    ):
        assert client.post("/auth/login", json=body, headers=headers).status_code == 200
        assert client.post("/auth/login", json=body, headers=headers).status_code == 200
        response = client.post("/auth/login/", json=body, headers=headers)
        assert response.status_code == 429
        assert response.headers["Retry-After"] == "60"
        assert response.headers["Cache-Control"] == "no-store"
        assert "Set-Cookie" not in response.headers
        assert response.headers["access-control-allow-origin"] == config.frontend_url
        assert response.headers["access-control-expose-headers"] == "Retry-After"
        assert response.json() == {"detail": "Too many attempts. Try again in 60 seconds."}
        assert verify.call_count == db.scalar.call_count == 2

        body_reads = []

        def unread_body():
            body_reads.append(True)
            yield b'{"password":"private test value"}'

        assert client.post("/auth/login", content=unread_body(), headers=headers).status_code == 429
        assert body_reads == []
        now[0] = 60.0
        assert client.post("/auth/login", json=body, headers=headers).status_code == 200
        assert verify.call_count == 3


def test_invalid_payloads_count_and_forwarded_headers_do_not_bypass_limits():
    config = settings(auth_register_max_attempts=1)
    app, db = service(config, lambda: 0.0)
    with TestClient(app) as client, patch("app.api.auth.hash_password") as hash_password:
        headers = {"Origin": config.frontend_url}
        assert client.post("/auth/register", json={}, headers=headers).status_code == 422
        headers |= {"X-Forwarded-For": "203.0.113.7", "Forwarded": "for=203.0.113.7"}
        response = client.post("/auth/register", json={"password": "never logged"}, headers=headers)
        assert response.status_code == 429
        assert response.headers["Retry-After"] == "600"
        assert "never logged" not in response.text
        db.add.assert_not_called()
        hash_password.assert_not_called()
        # Registration exhaustion leaves login, logout, health and preflight available.
        assert client.post("/auth/login", json={}, headers=headers).status_code == 422
        assert client.post("/auth/logout", headers=headers).status_code == 204
        assert client.get("/health").status_code == 200
        assert (
            client.options(
                "/auth/register", headers=headers | {"Access-Control-Request-Method": "POST"}
            ).status_code
            == 200
        )


def test_untrusted_origin_cannot_consume_auth_budget():
    config = settings(auth_login_max_attempts=1)
    app, db = service(config, lambda: 0.0)
    with TestClient(app) as client:
        for origin in (None, "null", "https://evil.example.com"):
            headers = {} if origin is None else {"Origin": origin}
            assert client.post("/auth/login", json={}, headers=headers).status_code == 403
        headers = {"Origin": config.frontend_url}
        body = {"email": "unknown@example.com", "password": "bad password"}
        assert client.post("/auth/login", json=body, headers=headers).status_code == 401
        assert client.post("/auth/login", json=body, headers=headers).status_code == 429
        assert db.scalar.call_count == 1


@pytest.mark.parametrize("mode", ["disabled", "auto"])
def test_local_defaults_and_explicit_disable_keep_auth_unthrottled(mode):
    config = settings(auth_rate_limit_mode=mode, auth_login_max_attempts=1)
    app, _ = service(config, lambda: 0.0)
    with TestClient(app) as client:
        for _ in range(3):
            assert (
                client.post(
                    "/auth/login", json={}, headers={"Origin": config.frontend_url}
                ).status_code
                == 422
            )


@pytest.mark.parametrize(
    "name",
    [
        "auth_login_max_attempts",
        "auth_login_max_total_attempts",
        "auth_login_window_seconds",
        "auth_register_max_attempts",
        "auth_register_max_total_attempts",
        "auth_register_window_seconds",
    ],
)
def test_limits_reject_zero(name):
    with pytest.raises(ValidationError):
        settings(**{name: 0})


@pytest.mark.parametrize("mode,expected", [("auto", 429), ("disabled", 422)])
def test_hosted_mode_enables_throttling_by_default(mode, expected):
    config = settings(
        app_env="production",
        auth_rate_limit_mode=mode,
        auth_login_max_attempts=1,
        frontend_url="https://study.example.com",
        session_secret="test-only-random-secret-at-least-32-characters",
        session_cookie_secure=True,
        database_url="postgresql://test:test@db.example.com/test?sslmode=require",
        material_storage_dir=Path.cwd() / "data",
        ai_provider="disabled",
    )
    app, _ = service(config, lambda: 0.0)
    with TestClient(app) as client:
        headers = {"Origin": config.frontend_url}
        assert client.post("/auth/login", json={}, headers=headers).status_code == 422
        assert client.post("/auth/login", json={}, headers=headers).status_code == expected


def test_openapi_documents_auth_retry_contract():
    app, _ = service(settings(), lambda: 0.0)
    paths = app.openapi()["paths"]
    for path in ("/auth/login", "/auth/register"):
        response = paths[path]["post"]["responses"]["429"]
        assert response["headers"]["Retry-After"]["schema"] == {"type": "integer", "minimum": 1}
    assert "429" not in paths["/auth/logout"]["post"]["responses"]
