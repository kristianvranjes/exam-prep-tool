from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.auth import logout, set_session_cookie
from app.config import Settings
from app.models import User
from app.origin_guard import OriginGuard
from app.schemas.concept import ConceptExtractionResult
from app.services.ai.base import AIError
from app.services.ai.providers.openai_compatible import OpenAICompatibleProvider, validate_https_url
from app.services.ai.router import get_ai_provider
from app.services.ai.service import generate_validated
from app.services.auth import read_session


def hosted(**changes):
    values = dict(
        app_env="staging",
        frontend_url="https://study.example.com",
        session_secret="a-test-only-random-session-secret-123456789",
        session_cookie_secure=True,
        session_cookie_samesite="none",
        database_url="postgres://user:password@db.example.com/app?sslmode=require",
        material_storage_dir=Path.cwd() / "data" / "materials",
        ai_provider="openai_compatible",
        openai_compatible_url="https://ai.example.com/v1",
        openai_compatible_model="configured-model",
        openai_compatible_api_key="private-test-key",
    )
    return Settings(_env_file=None, **(values | changes))


def test_hosted_database_url_and_secret_redaction():
    settings = hosted()
    assert settings.database_url.startswith("postgresql+psycopg://")
    assert settings.database_url.endswith("?sslmode=require")
    assert "password" not in repr(settings) and "private-test-key" not in repr(settings)


def test_openai_compatible_prefixed_v1_base_url_is_accepted():
    url = "https://openrouter.ai/api/v1/"
    assert validate_https_url(url) == "https://openrouter.ai/api/v1"
    assert hosted(openai_compatible_url=url).openai_compatible_url == url


@pytest.mark.parametrize(
    "url",
    [
        "https://ai.example.com/v2",
        "https://ai.example.com/v1/chat/completions",
        "https://ai.example.com/api/v1?token=secret",
        "https://user:password@ai.example.com/api/v1",
        "https://127.0.0.1/api/v1",
    ],
)
def test_openai_compatible_unsafe_or_non_base_urls_are_rejected(url):
    with pytest.raises(ValueError):
        validate_https_url(url)


@pytest.mark.parametrize(
    "field,value",
    [
        ("frontend_url", "*"),
        ("frontend_url", "https://example.com/path"),
        ("frontend_url", "http://localhost:3000"),
        ("session_cookie_secure", False),
        ("session_secret", "replace-with-a-long-random-secret"),
        ("database_url", "postgresql://user:secret@db.example.com/db"),
        ("ai_provider", "ollama"),
        ("openai_compatible_url", "http://ai.example.com/v1"),
        ("openai_compatible_url", "https://127.0.0.1/v1"),
        ("openai_compatible_api_key", ""),
        ("material_storage_dir", "data/materials"),
    ],
)
def test_unsafe_hosted_configuration_fails(field, value):
    values = hosted().model_dump()
    values[field] = value
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **values)


def test_none_cookie_requires_secure_locally():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, session_cookie_samesite="none", session_cookie_secure=False)


def test_staging_cookies_origin_guard_and_cors():
    settings = hosted()
    service = FastAPI()
    service.add_middleware(OriginGuard, origin=settings.frontend_url, enabled=True)
    service.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_url],
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    user = User(id=uuid4())

    @service.post("/login")
    def login():
        from fastapi import Response

        response = Response()
        set_session_cookie(response, user)
        return response

    @service.post("/logout")
    def signout():
        from fastapi import Response

        response = Response()
        logout(response)
        return response

    with (
        patch("app.api.auth.Settings", return_value=settings),
        TestClient(service, base_url="https://api.example.com") as client,
    ):
        for origin in [None, "null", "https://evil.example", "https://study.example.com.evil.test"]:
            response = client.post("/login", headers={"Origin": origin} if origin else {})
            assert response.status_code == 403 and "set-cookie" not in response.headers
        headers = {"Origin": settings.frontend_url}
        response = client.post("/login", headers=headers)
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == settings.frontend_url
        assert response.headers["access-control-allow-credentials"] == "true"
        cookie = response.headers["set-cookie"]
        assert all(flag in cookie for flag in ["HttpOnly", "Secure", "SameSite=none", "Path=/"])
        assert "Domain=" not in cookie
        assert read_session(client.cookies.get(settings.session_cookie_name), settings) == user.id
        preflight = client.options(
            "/login", headers=headers | {"Access-Control-Request-Method": "POST"}
        )
        assert preflight.status_code == 200
        response = client.post("/logout", headers=headers)
        assert "Max-Age=0" in response.headers["set-cookie"]
        assert "SameSite=none" in response.headers["set-cookie"]
        assert not client.cookies.get(settings.session_cookie_name)


@pytest.mark.parametrize("mode", ["valid", "invalid", "key", "timeout", "failure"])
def test_https_provider_mocked_and_validated(monkeypatch, mode):
    settings = hosted()
    monkeypatch.setattr("app.services.ai.router.Settings", lambda: settings)
    provider = get_ai_provider()
    assert isinstance(provider, OpenAICompatibleProvider) and provider.name == "openai_compatible"
    original = httpx.Client

    def handler(request):
        import json

        assert str(request.url) == "https://ai.example.com/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer private-test-key"
        payload = json.loads(request.content)
        assert payload["stream"] is False and payload["max_tokens"] == 2048
        if mode == "timeout":
            raise httpx.ReadTimeout("private-test-key internal url")
        if mode == "failure":
            return httpx.Response(500, text="private-test-key")
        content = {
            "valid": '{"concepts":[]}',
            "invalid": '{"untrusted":1}',
            "key": "private-test-key",
        }[mode]
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    monkeypatch.setattr(
        httpx, "Client", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs)
    )
    if mode == "valid":
        envelope = provider.generate_structured("system", "context", ConceptExtractionResult)
        assert envelope.prompt_tokens is None
    else:
        with pytest.raises(AIError) as failure:
            generate_validated(provider, "system", "context", ConceptExtractionResult)
        assert "private-test-key" not in str(failure.value)


def test_start_uses_port_without_reload(monkeypatch):
    from app.start import main

    monkeypatch.setenv("PORT", "9123")
    with patch("os.execv") as execute:
        main()
    args = execute.call_args.args[1]
    assert args[args.index("--port") + 1] == "9123"
    assert "--reload" not in args and "--no-access-log" in args


@pytest.mark.parametrize("port", ["0", "65536", "not-a-port", ""])
def test_start_rejects_invalid_port(monkeypatch, port):
    from app.start import main

    monkeypatch.setenv("PORT", port)
    with patch("os.execv") as execute, pytest.raises(ValueError):
        main()
    execute.assert_not_called()


def test_start_defaults_to_local_port(monkeypatch):
    from app.start import main

    monkeypatch.delenv("PORT", raising=False)
    with patch("os.execv") as execute:
        main()
    args = execute.call_args.args[1]
    assert args[args.index("--port") + 1] == "8000"


@pytest.mark.parametrize(
    "environment,samesite,secure,guarded",
    [
        ("staging", "none", True, True),
        ("staging", "lax", True, True),
        ("production", "lax", True, True),
        ("development", "none", True, True),
        ("development", "lax", False, False),
    ],
)
def test_actual_app_origin_policy(environment, samesite, secure, guarded):
    import importlib

    import app.main as main_module

    settings = hosted(
        app_env=environment, session_cookie_samesite=samesite, session_cookie_secure=secure
    )
    try:
        with patch("app.config.Settings", return_value=settings):
            service = importlib.reload(main_module).app
        with patch("app.api.auth.Settings", return_value=settings), TestClient(service) as client:
            assert client.get("/health").status_code == 200
            for origin in [None, "null", "https://untrusted.example"]:
                headers = {"Origin": origin} if origin else {}
                response = client.post("/auth/logout", headers=headers)
                assert response.status_code == (403 if guarded else 204)
                assert "access-control-allow-origin" not in response.headers
            trusted = {"Origin": settings.frontend_url}
            assert client.post("/auth/logout", headers=trusted).status_code == 204
            for method in ["POST", "PATCH", "DELETE"]:
                assert (
                    client.options(
                        "/courses",
                        headers=trusted | {"Access-Control-Request-Method": method},
                    ).status_code
                    == 200
                )
                if guarded:
                    assert client.request(method, "/courses").status_code == 403
    finally:
        importlib.reload(main_module)


@pytest.mark.parametrize("scheme", ["postgres", "postgresql", "postgresql+psycopg"])
def test_managed_database_url_preserves_credentials_and_tls(scheme):
    from sqlalchemy.engine import make_url

    settings = hosted(
        database_url=f"{scheme}://user:p%40ss%25word@db.example.com/app"
        "?sslmode=verify-full&channel_binding=require"
    )
    url = make_url(settings.database_url)
    assert url.drivername == "postgresql+psycopg"
    assert url.password == "p@ss%word"
    assert url.query == {"sslmode": "verify-full", "channel_binding": "require"}
