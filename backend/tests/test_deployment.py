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
from app.services.ai.providers.openai_compatible import OpenAICompatibleProvider
from app.services.ai.router import get_ai_provider
from app.services.ai.service import generate_validated
from app.services.auth import read_session


def hosted(**changes):
    return Settings(
        _env_file=None,
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
        **changes,
    )


def test_hosted_database_url_and_secret_redaction():
    settings = hosted()
    assert settings.database_url.startswith("postgresql+psycopg://")
    assert settings.database_url.endswith("?sslmode=require")
    assert "password" not in repr(settings) and "private-test-key" not in repr(settings)


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
        # Transport accepts JSON, while the shared layer still enforces the supplied schema.
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
