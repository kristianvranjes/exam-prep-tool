from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.courses import router as courses_router
from app.api.health import router as health_router
from app.api.materials import router as materials_router
from app.config import Settings
from app.database import engine
from app.upload_limit import MaterialUploadLimit


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    engine.dispose()


settings = Settings()
app = FastAPI(title="ExamPrep API", lifespan=lifespan)
app.add_middleware(MaterialUploadLimit)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(courses_router)
app.include_router(materials_router)
