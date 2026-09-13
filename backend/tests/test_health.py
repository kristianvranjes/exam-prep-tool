from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.main import app
from app.services.health import check_database


def test_health() -> None:
    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "ok"}
        response = client.get("/health", headers={"Origin": "http://localhost:3000"})
        assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
        response = client.get("/health", headers={"Origin": "https://untrusted.example"})
        assert "access-control-allow-origin" not in response.headers


def test_database_health_success() -> None:
    engine = MagicMock()
    assert check_database(engine).database == "ok"
    engine.connect.return_value.__enter__.return_value.execute.assert_called_once()


def test_database_failure_is_sanitized() -> None:
    with patch("app.api.health.engine") as engine:
        engine.connect.side_effect = OperationalError("secret connection details", {}, Exception())
        with TestClient(app) as client:
            response = client.get("/health/db")
        assert response.status_code == 503
        assert response.json() == {"status": "error", "database": "unavailable"}
