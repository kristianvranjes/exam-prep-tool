from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.concepts import router as concepts_router
from app.api.course_units import router as course_units_router
from app.api.courses import router as courses_router
from app.api.exam_papers import router as exam_papers_router
from app.api.exam_scopes import router as exam_scopes_router
from app.api.faculties import router as faculties_router
from app.api.health import router as health_router
from app.api.item_analysis import router as item_analysis_router
from app.api.materials import router as materials_router
from app.api.moderation import router as moderation_router
from app.api.progress import router as progress_router
from app.api.questions import router as questions_router
from app.api.quizzes import availability_router
from app.api.quizzes import router as quizzes_router
from app.api.reports import router as reports_router
from app.api.retrieval import router as retrieval_router
from app.api.suggestions import router as suggestions_router
from app.config import Settings
from app.database import engine
from app.origin_guard import OriginGuard
from app.upload_limit import MaterialUploadLimit


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    engine.dispose()


settings = Settings()
app = FastAPI(title="ExamPrep API", lifespan=lifespan)
app.add_middleware(MaterialUploadLimit)
app.add_middleware(
    OriginGuard,
    origin=settings.frontend_url,
    enabled=settings.app_env in ("staging", "production")
    or settings.session_cookie_samesite == "none",
)
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
app.include_router(course_units_router)
app.include_router(exam_scopes_router)
app.include_router(exam_papers_router)
app.include_router(faculties_router)
app.include_router(moderation_router)
app.include_router(materials_router)
app.include_router(concepts_router)
app.include_router(retrieval_router)
app.include_router(questions_router)
app.include_router(reports_router)
app.include_router(suggestions_router)
app.include_router(item_analysis_router)
app.include_router(quizzes_router)
app.include_router(availability_router)

app.include_router(progress_router)
