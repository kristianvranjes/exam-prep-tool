from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import Settings
from app.dependencies import get_current_user, get_db
from app.models import User
from app.models.concept import Concept
from app.schemas.concept import ConceptDetail, ConceptResponse, JobDetail, ReviewRequest
from app.services.ai.base import AIProvider
from app.services.ai.router import get_ai_provider
from app.services.concepts import service

router = APIRouter(tags=["concepts"])


@router.post("/materials/{material_id}/concept-extraction", response_model=JobDetail)
def extract(
    material_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    provider: AIProvider = Depends(get_ai_provider),
) -> JobDetail:
    return service.extract_concepts(db, user, material_id, provider, Settings())


@router.get("/courses/{course_id}/concepts", response_model=list[ConceptResponse])
def list_concepts(
    course_id: UUID,
    material_id: UUID | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Concept]:
    return service.list_concepts(db, user, course_id, material_id)


@router.get("/concepts/{concept_id}", response_model=ConceptDetail)
def detail(
    concept_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ConceptDetail:
    return service.concept_detail(db, user, concept_id)


@router.patch("/concepts/{concept_id}/status", response_model=ConceptResponse)
def review(
    concept_id: UUID,
    data: ReviewRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Concept:
    return service.review_concept(db, user, concept_id, data.status)


@router.get("/ai/jobs/{job_id}", response_model=JobDetail)
def job(
    job_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> JobDetail:
    return service.job_detail(db, user, job_id)
