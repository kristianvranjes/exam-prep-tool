import json
from uuid import uuid4

import httpx
import pytest
from pydantic import SecretStr, ValidationError

from app.config import Settings
from app.schemas.concept import ConceptExtractionResult
from app.services.ai.base import AIError
from app.services.ai.prompts.concepts import SYSTEM_PROMPT, ChunkInput, user_prompt
from app.services.ai.providers.freellmapi import FreeLLMAPIProvider, routed_metadata, validate_url
from app.services.ai.providers.ollama import OllamaProvider
from app.services.ai.router import get_ai_provider
from app.services.ai.service import generate_validated

KEY = "test-private-api-key"


@pytest.fixture
def provider():
    return FreeLLMAPIProvider("http://localhost:3001/v1", "auto", SecretStr(KEY), 2)


def mock_http(monkeypatch, handler):
    original = httpx.Client

    def client(**kwargs):
        assert kwargs["trust_env"] is False
        assert kwargs["follow_redirects"] is False
        return original(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(httpx, "Client", client)


def test_routing(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "ollama")
    assert isinstance(get_ai_provider(), OllamaProvider)
    monkeypatch.setenv("AI_PROVIDER", "freellmapi")
    monkeypatch.setenv("FREELLMAPI_API_KEY", KEY)
    monkeypatch.setenv("FREELLMAPI_MODEL", "auto")
    assert isinstance(get_ai_provider(), FreeLLMAPIProvider)
    assert get_ai_provider().model == "auto"
    assert KEY not in repr(Settings())
    monkeypatch.setenv("FREELLMAPI_MODEL", "chosen-model")
    assert get_ai_provider().model == "chosen-model"
    monkeypatch.setenv("AI_PROVIDER", "unsupported")
    with pytest.raises(ValidationError):
        Settings()


@pytest.mark.parametrize(
    "usage",
    [
        None,
        {},
        {"prompt_tokens": 12},
        {"total_tokens": 30},
        {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20},
    ],
)
def test_structured_response_and_usage(monkeypatch, provider, usage):
    prompt = user_prompt([ChunkInput(uuid4(), 0, "Algebra")])

    def handler(request):
        assert str(request.url) == "http://localhost:3001/v1/chat/completions"
        assert request.headers["Authorization"] == f"Bearer {KEY}"
        body = json.loads(request.content)
        assert body == {
            "model": "auto",
            "stream": False,
            "temperature": 0,
            "max_tokens": 2048,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
        }
        content = json.dumps(
            {
                "concepts": [
                    {
                        "name": "Algebra",
                        "description": "Study of algebra",
                        "aliases": [],
                        "importance": "HIGH",
                        "source_chunk_ordinals": [0],
                    }
                ]
            }
        )
        return httpx.Response(
            200,
            headers={"X-Routed-Via": "platform/org/model"},
            json={
                "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
                "usage": usage,
            },
        )

    mock_http(monkeypatch, handler)
    result, generation = generate_validated(
        provider, SYSTEM_PROMPT, prompt, ConceptExtractionResult
    )
    assert result.concepts[0].name == "Algebra"
    assert generation.prompt_tokens == (usage or {}).get("prompt_tokens")
    assert generation.completion_tokens == (usage or {}).get("completion_tokens")
    assert generation.total_tokens == (usage or {}).get("total_tokens")
    assert (generation.routed_provider, generation.routed_model) == ("platform", "org/model")


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"choices": []},
        {"choices": [{"message": {"content": None}}]},
        {"choices": [{"message": {"content": "not json"}}]},
        {"choices": [{"message": {"content": '{"concepts":[{"name":42}]}'}}]},
        {"choices": [{"message": {"content": '{"concepts":[]}'}, "finish_reason": "length"}]},
    ],
)
def test_invalid_output(monkeypatch, provider, body):
    mock_http(monkeypatch, lambda request: httpx.Response(200, json=body))
    with pytest.raises(AIError, match="INVALID_OUTPUT"):
        generate_validated(provider, "system", "chunks", ConceptExtractionResult)


@pytest.mark.parametrize(
    "mode,code",
    [
        ("timeout", "TIMEOUT"),
        ("network", "UNAVAILABLE"),
        (401, "UNAVAILABLE"),
        (500, "UNAVAILABLE"),
        (302, "UNAVAILABLE"),
    ],
)
def test_safe_failures(monkeypatch, provider, mode, code, caplog):
    private = f"{KEY} http://private.internal upstream traceback"

    def handler(request):
        if mode == "timeout":
            raise httpx.ReadTimeout(private, request=request)
        if mode == "network":
            raise httpx.ConnectError(private, request=request)
        return httpx.Response(mode, text=private)

    mock_http(monkeypatch, handler)
    with pytest.raises(AIError) as caught:
        generate_validated(provider, "system", "chunks", ConceptExtractionResult)
    assert caught.value.code == code
    assert KEY not in str(caught.value) + repr(caught.value) + caplog.text
    assert "private.internal" not in str(caught.value)
    assert caught.value.__suppress_context__


@pytest.mark.parametrize(
    "header",
    [
        None,
        "http://internal/model",
        f"platform/{KEY}",
        "provider/model secret",
        "x" * 51 + "/model",
    ],
)
def test_unsafe_metadata_ignored(header):
    assert routed_metadata(header, KEY) == (None, None)


@pytest.mark.parametrize(
    "url",
    [
        "http://8.8.8.8/v1",
        "http://localhost/v1?key=secret",
        "http://user:secret@localhost/v1",
        "http://localhost/other",
    ],
)
def test_unsafe_url(url):
    with pytest.raises(AIError, match="INVALID_CONFIGURATION"):
        validate_url(url)


def test_missing_key_never_requests(monkeypatch):
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: pytest.fail("Must not connect"))
    with pytest.raises(AIError, match="INVALID_CONFIGURATION"):
        FreeLLMAPIProvider(
            "http://localhost:3001/v1", "auto", SecretStr(""), 2
        ).generate_structured("system", "chunks", ConceptExtractionResult)


@pytest.mark.parametrize(
    "mode", ["invalid_json", "invalid_schema", "truncated", "key_echo", "escaped_key_echo"]
)
def test_rejected_content_keeps_usage_without_content(monkeypatch, provider, mode, caplog):
    import logging

    caplog.set_level(logging.INFO)
    content = {
        "invalid_json": "private rejected output",
        "invalid_schema": '{"wrong":true}',
        "truncated": '{"concepts":[]}',
        "key_echo": json.dumps(
            {
                "concepts": [
                    {
                        "name": "Algebra",
                        "description": KEY,
                        "aliases": [],
                        "importance": "HIGH",
                        "source_chunk_ordinals": [0],
                    }
                ]
            }
        ),
    }["key_echo" if mode == "escaped_key_echo" else mode]
    if mode == "escaped_key_echo":
        content = content.replace(KEY, "".join(f"\\u{ord(char):04x}" for char in KEY))
    mock_http(
        monkeypatch,
        lambda request: httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {"content": content},
                        "finish_reason": "length" if mode == "truncated" else "stop",
                    }
                ],
                "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30},
            },
        ),
    )
    with pytest.raises(AIError) as caught:
        generate_validated(
            provider, "private system prompt", "private source chunk", ConceptExtractionResult
        )
    assert caught.value.code == "INVALID_OUTPUT"
    assert caught.value.generation.content == ""
    assert caught.value.generation.total_tokens == 30
    output = repr(vars(caught.value)) + str(caught.value) + caplog.text
    for private in (
        KEY,
        "private rejected output",
        "private system prompt",
        "private source chunk",
    ):
        assert private not in output
