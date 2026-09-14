from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import User
from app.models.material import Material
from app.models.material_chunk import MaterialChunk
from app.schemas.retrieval import SearchHit, SearchRequest
from app.services.courses import get_member_course
from app.services.embeddings.base import EmbeddingError, EmbeddingProvider, embed_validated
from app.services.embeddings.service import provider_failure


def search(
    db: Session, user: User, course_id: UUID, request: SearchRequest, provider: EmbeddingProvider
) -> list[SearchHit]:
    get_member_course(db, user, course_id)
    try:
        vector = embed_validated(provider, [request.query])[0]
    except EmbeddingError as error:
        raise provider_failure(error) from None
    distance = MaterialChunk.embedding.cosine_distance(vector).label("distance")
    # Hash the current text inside the scoped SQL query, so even direct content edits
    # cannot make an old vector searchable. All values are SQLAlchemy bind parameters.
    current_hash = func.encode(func.sha256(func.convert_to(MaterialChunk.content, "UTF8")), "hex")
    query = (
        select(
            MaterialChunk.id,
            MaterialChunk.material_id,
            MaterialChunk.ordinal,
            MaterialChunk.content,
            distance,
        )
        .join(Material, Material.id == MaterialChunk.material_id)
        .where(
            Material.course_id == course_id,
            Material.status == "READY",
            MaterialChunk.embedding.is_not(None),
            MaterialChunk.embedding_signature == provider.signature,
            MaterialChunk.embedding_content_hash == current_hash,
        )
        .order_by(distance, MaterialChunk.material_id, MaterialChunk.ordinal, MaterialChunk.id)
        .limit(request.top_k)
    )
    try:
        return [
            SearchHit(
                chunk_id=row.id,
                material_id=row.material_id,
                ordinal=row.ordinal,
                content=row.content,
                distance=float(row.distance),
                similarity=1.0 - float(row.distance),
            )
            for row in db.execute(query)
        ]
    except SQLAlchemyError:
        raise HTTPException(503, "Retrieval is unavailable") from None
