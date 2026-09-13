from fastapi import APIRouter, Response

from app.database import engine
from app.services.health import HealthResponse, check_database

router = APIRouter(tags=["health"])


@router.get("/health", response_model_exclude_none=True)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/health/db", responses={503: {"model": HealthResponse}})
def database_health(response: Response) -> HealthResponse:
    result = check_database(engine)
    if result.status != "ok":
        response.status_code = 503
    return result
