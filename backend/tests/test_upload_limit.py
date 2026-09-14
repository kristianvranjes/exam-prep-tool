import pytest
from fastapi.testclient import TestClient

from app.main import app


def test_declared_upload_request_limit(monkeypatch):
    monkeypatch.setenv("MATERIAL_MAX_UPLOAD_BYTES", "10")
    with TestClient(app) as client:
        response = client.post("/courses/any/materials", content=b"x" * 65547)
        assert response.status_code == 413


@pytest.mark.anyio
async def test_streaming_upload_request_limit(monkeypatch):
    from starlette.exceptions import HTTPException

    from app.upload_limit import MaterialUploadLimit

    monkeypatch.setenv("MATERIAL_MAX_UPLOAD_BYTES", "10")

    async def downstream(scope, receive, send):
        await receive()
        await receive()

    messages = iter(
        [
            {"type": "http.request", "body": b"x" * 40000, "more_body": True},
            {"type": "http.request", "body": b"x" * 40000, "more_body": False},
        ]
    )

    async def receive():
        return next(messages)

    async def send(message):
        pass

    with pytest.raises(HTTPException) as error:
        await MaterialUploadLimit(downstream)(
            {"type": "http", "method": "POST", "path": "/courses/any/materials", "headers": []},
            receive,
            send,
        )
    assert error.value.status_code == 413


@pytest.fixture
def anyio_backend():
    return "asyncio"
