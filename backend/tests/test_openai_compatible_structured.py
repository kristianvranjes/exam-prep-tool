import json

import httpx
from pydantic import SecretStr

from app.schemas.concept import ConceptExtractionResult
from app.services.ai.providers.openai_compatible import OpenAICompatibleProvider
from app.services.ai.service import generate_validated


def provider(url: str) -> OpenAICompatibleProvider:
    return OpenAICompatibleProvider(
        url=url,
        model="openrouter/free",
        api_key=SecretStr("private-test-key"),
        timeout=5,
    )


def test_openrouter_requests_strict_json_schema_and_parameter_support(monkeypatch):
    actual = provider("https://openrouter.ai/api/v1")
    original = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        response_format = payload["response_format"]
        assert response_format["type"] == "json_schema"
        assert response_format["json_schema"]["name"] == "ConceptExtractionResult"
        assert response_format["json_schema"]["strict"] is True
        assert (
            response_format["json_schema"]["schema"]
            == ConceptExtractionResult.model_json_schema()
        )
        assert payload["provider"] == {"require_parameters": True}
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": '{"concepts":[]}'}, "finish_reason": "stop"}
                ]
            },
        )

    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs),
    )

    result, _ = generate_validated(actual, "system", "context", ConceptExtractionResult)
    assert result.concepts == []


def test_non_openrouter_host_uses_schema_without_openrouter_routing_option():
    options = provider("https://ai.example.com/v1").structured_output_options(
        ConceptExtractionResult
    )
    assert options["response_format"] == {
        "type": "json_schema",
        "json_schema": {
            "name": "ConceptExtractionResult",
            "strict": True,
            "schema": ConceptExtractionResult.model_json_schema(),
        },
    }
    assert "provider" not in options
