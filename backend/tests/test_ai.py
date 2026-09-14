from uuid import uuid4

import httpx
import pytest
from fake_ai import FakeProvider

from app.schemas.concept import ConceptExtractionResult
from app.services.ai.base import AIError
from app.services.ai.prompts.concepts import SYSTEM_PROMPT, ChunkInput, batch_chunks, user_prompt
from app.services.ai.providers.ollama import OllamaProvider, validate_local_url
from app.services.ai.service import generate_validated
from app.services.concepts.service import merge_results, normalize_name


def test_validation_normalization_and_merge():
    provider = FakeProvider()
    batch = [ChunkInput(uuid4(), 0, "Linear algebra")]
    result, usage = generate_validated(
        provider, SYSTEM_PROMPT, user_prompt(batch), ConceptExtractionResult
    )
    second, _ = generate_validated(
        provider,
        SYSTEM_PROMPT,
        user_prompt([ChunkInput(uuid4(), 1, "More")]),
        ConceptExtractionResult,
    )
    merged = merge_results(result.concepts + second.concepts)
    assert list(merged) == ["linear algebra"]
    assert merged["linear algebra"].source_chunk_ordinals == [0, 1]
    assert normalize_name("  ČISTA  Matematika ") == "čista matematika"
    assert usage.prompt_tokens == 10


def test_batching_bounds_and_stability():
    chunks = [ChunkInput(uuid4(), n, "text " * 80) for n in range(5)]
    max_chars = len(SYSTEM_PROMPT) + len(user_prompt(chunks[:2]))
    batches = batch_chunks(list(reversed(chunks)), max_chars, 2, 5)
    assert batches == batch_chunks(chunks, max_chars, 2, 5)
    assert [c.ordinal for b in batches for c in b] == list(range(5))
    assert all(
        len(b) <= 2 and len(SYSTEM_PROMPT) + len(user_prompt(b)) <= max_chars for b in batches
    )
    with pytest.raises(ValueError):
        batch_chunks(chunks, 10, 2, 5)
    with pytest.raises(ValueError):
        batch_chunks(chunks, max_chars, 1, 2)


@pytest.mark.parametrize(
    "url",
    [
        "https://ollama.com",
        "http://8.8.8.8",
        "http://localhost@evil.com",
        "http://localhost/path",
        "http://localhost?secret=x",
    ],
)
def test_cloud_and_unsafe_urls_rejected(url):
    with pytest.raises(AIError):
        validate_local_url(url)


def test_ollama_schema_and_usage(monkeypatch):
    original = httpx.Client

    def handler(request):
        import json

        body = json.loads(request.content)
        assert body["format"] == ConceptExtractionResult.model_json_schema()
        assert body["think"] is False
        assert body["stream"] is False
        assert body["options"]["temperature"] == 0
        return httpx.Response(
            200,
            json={
                "done": True,
                "message": {"content": '{"concepts":[]}'},
                "prompt_eval_count": 15,
                "eval_count": 7,
            },
        )

    def client(**kwargs):
        assert kwargs["trust_env"] is False
        assert kwargs["follow_redirects"] is False
        return original(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(httpx, "Client", client)
    result, usage = generate_validated(
        OllamaProvider("http://localhost:11434", "qwen3:4b", 10),
        "system",
        "chunks",
        ConceptExtractionResult,
    )
    assert result.concepts == []
    assert (usage.prompt_tokens, usage.completion_tokens) == (15, 7)


@pytest.mark.parametrize(
    "mode,code", [("timeout", "TIMEOUT"), ("http", "UNAVAILABLE"), ("badjson", "INVALID_OUTPUT")]
)
def test_ollama_safe_errors(monkeypatch, mode, code):
    original = httpx.Client

    def handler(request):
        if mode == "timeout":
            raise httpx.ReadTimeout("secret internal host", request=request)
        if mode == "http":
            return httpx.Response(500, text="secret internal host")
        return httpx.Response(200, json={"message": "invalid"})

    monkeypatch.setattr(
        httpx, "Client", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs)
    )
    with pytest.raises(AIError) as error:
        generate_validated(
            OllamaProvider("http://localhost:11434", "qwen3:4b", 1),
            "system",
            "chunks",
            ConceptExtractionResult,
        )
    assert error.value.code == code
    assert "secret" not in str(error.value)


def test_missing_token_counts_are_none(monkeypatch):
    original = httpx.Client
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kwargs: original(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200, json={"done": True, "message": {"content": '{"concepts":[]}'}}
                )
            ),
            **kwargs,
        ),
    )
    _, usage = generate_validated(
        OllamaProvider("http://localhost:11434", "qwen3:4b", 1),
        "system",
        "chunks",
        ConceptExtractionResult,
    )
    assert usage.prompt_tokens is None
    assert usage.completion_tokens is None
