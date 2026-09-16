import json
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.schemas.question import QuizImport
from app.services.questions.importing import import_questions, read_import

EXAMPLE = Path(__file__).parents[2] / "frontend/public/quiz-import-v1.example.json"


def document():
    return json.loads(EXAMPLE.read_text())


@pytest.mark.parametrize("indices", [[0], [1], [2], [0, 1, 2]])
def test_supported_types(indices):
    body = document()
    body["questions"] = [body["questions"][i] for i in indices]
    assert len(QuizImport.model_validate(body).questions) == len(indices)


@pytest.mark.parametrize(
    "change",
    [
        {"version": "quiz-import-v2"},
        {"questions": []},
        {"status": "APPROVED"},
        {"questions": [{"type": "ESSAY", "stem": "No"}]},
    ],
)
def test_invalid_document(change):
    with pytest.raises(ValidationError):
        QuizImport.model_validate(document() | change)


@pytest.mark.parametrize(
    "change",
    [
        {"status": "APPROVED"},
        {"source": "AI"},
        {"concept_ids": []},
        {"stem": " "},
        {"stem": "x" * 401},
        {"difficulty": True},
        {"options": [{"text": "A", "is_correct": True}, {"text": "a", "is_correct": False}]},
        {"options": [{"text": "A", "is_correct": False}, {"text": "B", "is_correct": False}]},
    ],
)
def test_reuses_strict_content_validation(change):
    body = document()
    body["questions"][0].update(change)
    with pytest.raises(ValidationError):
        QuizImport.model_validate(body)


def test_duplicate_stems_and_hard_count_limit():
    body = document()
    body["questions"].append(body["questions"][0])
    with pytest.raises(ValidationError):
        QuizImport.model_validate(body)
    body["questions"] = [
        {"type": "SHORT_ANSWER", "stem": str(i), "reference_answer": "A"} for i in range(51)
    ]
    with pytest.raises(ValidationError):
        QuizImport.model_validate(body)


def reader():
    app = FastAPI()

    @app.post("/import")
    def route(data: QuizImport = Depends(read_import)):
        return {"count": len(data.questions)}

    return TestClient(app)


def test_http_parsing_and_configured_limits(monkeypatch):
    with reader() as client:
        assert client.post("/import", json=document()).status_code == 200
        assert (
            client.post("/import", content="{}", headers={"Content-Type": "text/plain"}).status_code
            == 415
        )
        malformed = client.post(
            "/import", content="{", headers={"Content-Type": "application/json"}
        )
        assert malformed.status_code == 422 and "Invalid JSON" in malformed.json()["detail"]
        monkeypatch.setenv("QUESTION_IMPORT_MAX_COUNT", "2")
        assert client.post("/import", json=document()).status_code == 422
        monkeypatch.setenv("QUESTION_IMPORT_MAX_BYTES", "8")
        assert client.post("/import", json=document()).status_code == 413
        assert (
            client.post(
                "/import",
                content=iter([b"12345", b"67890"]),
                headers={"Content-Type": "application/json"},
            ).status_code
            == 413
        )


def test_database_failure_rolls_back_whole_import(monkeypatch):
    from app.services.questions import importing

    db = Mock()
    monkeypatch.setattr(importing, "get_owner_course", Mock())
    save = Mock(side_effect=[None, IntegrityError("insert", {}, Exception())])
    monkeypatch.setattr(importing, "save_content", save)
    monkeypatch.setattr(importing, "add_version", Mock())
    monkeypatch.setattr(importing, "owner_view", Mock())
    with pytest.raises(HTTPException) as error:
        import_questions(db, Mock(id=uuid4()), uuid4(), QuizImport.model_validate(document()))
    assert error.value.status_code == 409
    db.rollback.assert_called_once()
    db.commit.assert_not_called()
    assert save.call_count == 2


def test_hosted_disabled_provider_needs_no_ai_credentials():
    from test_deployment import hosted

    from app.config import Settings

    values = hosted().model_dump() | {
        "ai_provider": "disabled",
        "openai_compatible_url": "",
        "openai_compatible_model": "",
        "openai_compatible_api_key": "",
    }
    assert Settings(_env_file=None, **values).ai_provider == "disabled"


def test_disabled_provider_fails_explicitly(monkeypatch):
    from app.services.ai.router import get_ai_provider

    monkeypatch.setenv("AI_PROVIDER", "disabled")
    with pytest.raises(HTTPException) as error:
        get_ai_provider()
    assert error.value.status_code == 503


def test_internal_ai_still_requires_provenance_without_job(monkeypatch):
    from app.services.questions import service

    question = Mock(source="AI", ai_job_id=None, course_id=uuid4())
    concepts = Mock(side_effect=HTTPException(422, "Select unique approved concepts"))
    monkeypatch.setattr(service, "validate_concepts", concepts)
    with pytest.raises(HTTPException):
        service.validate_provenance(Mock(), question, [])
    concepts.assert_called_once()


@pytest.mark.anyio
async def test_stream_limit_without_content_length(monkeypatch):
    from starlette.requests import Request

    monkeypatch.setenv("QUESTION_IMPORT_MAX_BYTES", "8")
    chunks = iter(
        [
            {"type": "http.request", "body": b"12345", "more_body": True},
            {"type": "http.request", "body": b"67890", "more_body": False},
        ]
    )

    async def receive():
        return next(chunks)

    request = Request(
        {"type": "http", "headers": [(b"content-type", b"application/json")]}, receive
    )
    with pytest.raises(HTTPException) as error:
        await read_import(request)
    assert error.value.status_code == 413


@pytest.fixture
def anyio_backend():
    return "asyncio"
