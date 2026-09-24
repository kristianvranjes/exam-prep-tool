from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import Settings
from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.retrieval import EmbeddingResult, EmbeddingStatus, SearchHit, SearchRequest
from app.services.embeddings.base import EmbeddingProvider
from app.services.embeddings.router import get_embedding_provider
from app.services.embeddings.service import embed_material, get_embedding_status
from app.services.retrieval import search

router = APIRouter(tags=["retrieval"])


@router.get("/materials/{material_id}/embeddings", response_model=EmbeddingStatus)
def embedding_status(
    material_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    provider: EmbeddingProvider = Depends(get_embedding_provider),
) -> EmbeddingStatus:
    return get_embedding_status(db, user, material_id, provider)


@router.post("/materials/{material_id}/embeddings", response_model=EmbeddingResult)
def embed(
    material_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    provider: EmbeddingProvider = Depends(get_embedding_provider),
) -> EmbeddingResult:
    return embed_material(db, user, material_id, provider, Settings())


@router.post("/courses/{course_id}/retrieval/search", response_model=list[SearchHit])
def retrieve(
    course_id: UUID,
    data: SearchRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    provider: EmbeddingProvider = Depends(get_embedding_provider),
) -> list[SearchHit]:
    return search(db, user, course_id, data, provider)
