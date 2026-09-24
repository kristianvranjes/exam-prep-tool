from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import User
from app.models.material import Material
from app.models.material_chunk import MaterialChunk
from app.schemas.retrieval import EmbeddingResult, EmbeddingStatus
from app.services.embeddings.base import (
    EmbeddingError,
    EmbeddingProvider,
    content_hash,
    embed_validated,
)
from app.services.materials.service import get_material


def batch_texts(texts: list[str], settings: Settings) -> list[list[str]]:
    batches: list[list[str]] = []
    current: list[str] = []
    size = 0
    for text in texts:
        if not text.strip() or len(text) > min(
            settings.embedding_max_text_chars, settings.embedding_batch_chars
        ):
            raise HTTPException(422, "Chunk exceeds embedding input limits")
        if current and (
            len(current) == settings.embedding_batch_size
            or size + len(text) > settings.embedding_batch_chars
        ):
            batches.append(current)
            current, size = [], 0
        current.append(text)
        size += len(text)
    if current:
        batches.append(current)
    return batches


def provider_failure(error: EmbeddingError) -> HTTPException:
    if str(error) == "INPUT_LIMIT":
        return HTTPException(422, "Text exceeds embedding model input limits")
    return HTTPException(503, "Embedding service unavailable or returned invalid vectors")


def get_embedding_status(
    db: Session, user: User, material_id: UUID, provider: EmbeddingProvider
) -> EmbeddingStatus:
    material = get_material(db, user, material_id)
    if material.status != "READY":
        raise HTTPException(409, "Material must be READY")
    # Select only the fields needed for freshness; never read or return vector values.
    chunks = db.execute(
        select(
            MaterialChunk.content,
            MaterialChunk.embedding.is_not(None),
            MaterialChunk.embedded_at,
            MaterialChunk.embedding_content_hash,
            MaterialChunk.embedding_signature,
        ).where(MaterialChunk.material_id == material_id)
    )
    total = current = 0
    for content, has_embedding, embedded_at, stored_hash, signature in chunks:
        total += 1
        if (
            has_embedding
            and embedded_at is not None
            and signature == provider.signature
            and stored_hash == content_hash(content)
        ):
            current += 1
    return EmbeddingStatus(
        material_id=material_id,
        total_chunks=total,
        current_chunks=current,
        stale_chunks=total - current,
        is_current=total > 0 and current == total,
    )


def embed_material(
    db: Session, user: User, material_id: UUID, provider: EmbeddingProvider, settings: Settings
) -> EmbeddingResult:
    get_material(db, user, material_id)
    try:
        # Serialize refreshes, and protect source snapshots until the atomic commit.
        material = db.scalar(
            select(Material)
            .where(Material.id == material_id)
            .with_for_update(nowait=True)
            .execution_options(populate_existing=True)
        )
        if material is None:
            raise HTTPException(404, "Material not found")
        if material.status != "READY":
            raise HTTPException(409, "Material must be READY")
        chunks = list(
            db.scalars(
                select(MaterialChunk)
                .where(MaterialChunk.material_id == material_id)
                .order_by(MaterialChunk.ordinal, MaterialChunk.id)
                .limit(settings.embedding_max_chunks + 1)
                .with_for_update(nowait=True)
                .execution_options(populate_existing=True)
            )
        )
        if not chunks or len(chunks) > settings.embedding_max_chunks:
            raise HTTPException(422, "Material has no chunks or exceeds embedding chunk limit")
        stale = [
            chunk
            for chunk in chunks
            if chunk.embedded_at is None
            or chunk.embedding_content_hash != content_hash(chunk.content)
            or chunk.embedding_signature != provider.signature
        ]
        batches = batch_texts([chunk.content for chunk in stale], settings)
        vectors = []
        for batch in batches:
            vectors.extend(embed_validated(provider, batch))
        for chunk, vector in zip(stale, vectors, strict=True):
            chunk.embedding = vector
            chunk.embedding_content_hash = content_hash(chunk.content)
            chunk.embedding_signature = provider.signature
            chunk.embedded_at = datetime.now(UTC)
        db.commit()
        return EmbeddingResult(
            material_id=material_id,
            embedded=len(stale),
            skipped=len(chunks) - len(stale),
            signature=provider.signature,
        )
    except EmbeddingError as error:
        db.rollback()
        raise provider_failure(error) from None
    except HTTPException:
        db.rollback()
        raise
    except OperationalError as error:
        db.rollback()
        if getattr(error.orig, "sqlstate", None) == "55P03":
            raise HTTPException(409, "Material embedding refresh is busy") from None
        raise HTTPException(503, "Could not persist embeddings") from None
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not persist embeddings") from None
