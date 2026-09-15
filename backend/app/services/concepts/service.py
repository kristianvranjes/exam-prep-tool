from datetime import UTC, datetime
from time import perf_counter
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import Course, User
from app.models.ai_job import AIJob, AIUsage
from app.models.concept import Concept, ConceptChunk
from app.models.material_chunk import MaterialChunk
from app.schemas.concept import (
    ConceptDetail,
    ConceptExtractionResult,
    ConceptResponse,
    ExtractedConcept,
    JobDetail,
    JobResponse,
    SourceChunk,
    UsageResponse,
)
from app.services.ai.base import AIError, AIProvider, Generation
from app.services.ai.prompts.concepts import (
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    ChunkInput,
    batch_chunks,
    user_prompt,
)
from app.services.ai.service import generate_validated
from app.services.courses import get_member_course, get_owner_course
from app.services.materials.service import get_material


def normalize_name(name: str) -> str:
    return " ".join(name.casefold().split())


def merge_results(results: list[ExtractedConcept]) -> dict[str, ExtractedConcept]:
    merged: dict[str, ExtractedConcept] = {}
    for item in results:
        key = normalize_name(item.name)
        if key not in merged:
            merged[key] = item.model_copy(deep=True)
        else:
            prior = merged[key]
            prior.source_chunk_ordinals = sorted(
                set(prior.source_chunk_ordinals + item.source_chunk_ordinals)
            )
            prior.aliases = sorted(set(prior.aliases + item.aliases))
    return merged


def list_concepts(
    db: Session, user: User, course_id: UUID, material_id: UUID | None = None
) -> list[Concept]:
    get_member_course(db, user, course_id)
    query = select(Concept).where(Concept.course_id == course_id)
    if material_id is not None:
        material = get_material(db, user, material_id)
        if material.course_id != course_id:
            raise HTTPException(404, "Material not found")
        query = (
            query.join(ConceptChunk)
            .join(MaterialChunk)
            .where(MaterialChunk.material_id == material_id)
            .distinct()
        )
    return list(db.scalars(query.order_by(Concept.normalized_name)))


def get_concept(db: Session, user: User, concept_id: UUID) -> Concept:
    concept = db.get(Concept, concept_id)
    if concept is None:
        raise HTTPException(404, "Concept not found")
    get_member_course(db, user, concept.course_id)
    return concept


def concept_detail(db: Session, user: User, concept_id: UUID) -> ConceptDetail:
    concept = get_concept(db, user, concept_id)
    chunks = db.scalars(
        select(MaterialChunk)
        .join(ConceptChunk)
        .where(ConceptChunk.concept_id == concept_id)
        .order_by(MaterialChunk.material_id, MaterialChunk.ordinal)
    )
    return ConceptDetail(
        **ConceptResponse.model_validate(concept).model_dump(),
        source_chunks=[SourceChunk.model_validate(c) for c in chunks],
    )


def review_concept(db: Session, user: User, concept_id: UUID, status: str) -> Concept:
    concept = get_concept(db, user, concept_id)
    get_owner_course(db, user, concept.course_id)
    # Serialize review with extraction's final merge, without locking during inference.
    db.scalar(select(Course).where(Course.id == concept.course_id).with_for_update())
    db.refresh(concept)
    if concept.status != "DRAFT":
        raise HTTPException(409, "Only DRAFT concepts can be reviewed")
    concept.status = status
    db.commit()
    db.refresh(concept)
    return concept


def job_detail(db: Session, user: User, job_id: UUID) -> JobDetail:
    job = db.get(AIJob, job_id)
    if job is None:
        raise HTTPException(404, "AI job not found")
    get_member_course(db, user, job.course_id)
    if job.operation == "QUESTION_GENERATION":
        get_owner_course(db, user, job.course_id)
    usage = db.scalars(
        select(AIUsage).where(AIUsage.ai_job_id == job_id).order_by(AIUsage.batch_ordinal)
    )
    return JobDetail(
        **JobResponse.model_validate(job).model_dump(),
        usage=[UsageResponse.model_validate(row) for row in usage],
    )


def extract_concepts(
    db: Session, user: User, material_id: UUID, provider: AIProvider, settings: Settings
) -> JobDetail:
    material = get_material(db, user, material_id)
    if material.status != "READY":
        raise HTTPException(409, "Material must be READY")
    limit = settings.ai_max_batches * settings.ai_concept_chunks_per_request
    rows = list(
        db.scalars(
            select(MaterialChunk)
            .where(MaterialChunk.material_id == material_id)
            .order_by(MaterialChunk.ordinal)
            .limit(limit + 1)
        )
    )
    if len(rows) > limit:
        raise HTTPException(422, "Material exceeds AI batch limits")
    chunks = [ChunkInput(row.id, row.ordinal, row.content) for row in rows]
    try:
        batches = batch_chunks(
            chunks,
            settings.ai_max_input_chars,
            settings.ai_concept_chunks_per_request,
            settings.ai_max_batches,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    job = AIJob(
        course_id=material.course_id,
        material_id=material.id,
        requested_by_user_id=user.id,
        provider=provider.name,
        model=provider.model,
        prompt_version=PROMPT_VERSION,
        status="RUNNING",
        input_chunk_count=len(chunks),
        input_char_count=sum(len(c.content) for c in chunks),
        input_chunk_ids=[str(c.id) for c in chunks],
        batch_count=len(batches),
    )
    db.add(job)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An extraction is already running for this course") from None
    job_id = job.id
    results: list[ExtractedConcept] = []
    try:
        for index, batch in enumerate(batches):
            started = perf_counter()
            generation: Generation | None = None
            try:
                result, generation = generate_validated(
                    provider, SYSTEM_PROMPT, user_prompt(batch), ConceptExtractionResult
                )
                allowed = {c.ordinal for c in batch}
                if any(not set(c.source_chunk_ordinals) <= allowed for c in result.concepts):
                    raise AIError("INVALID_PROVENANCE")
                results.extend(result.concepts)
            except AIError as exc:
                generation = generation or exc.generation
                raise
            finally:
                prompt_tokens = generation.prompt_tokens if generation else None
                completion_tokens = generation.completion_tokens if generation else None
                db.add(
                    AIUsage(
                        ai_job_id=job_id,
                        batch_ordinal=index,
                        provider=(generation.routed_provider if generation else None)
                        or provider.name,
                        model=(generation.routed_model if generation else None) or provider.model,
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        total_tokens=(
                            generation.total_tokens
                            if generation is not None and generation.total_tokens is not None
                            else (
                                prompt_tokens + completion_tokens
                                if prompt_tokens is not None and completion_tokens is not None
                                else None
                            )
                        ),
                        latency_ms=int((perf_counter() - started) * 1000),
                        estimated_cost=0,
                    )
                )
                db.commit()
        db.scalar(select(Course).where(Course.id == material.course_id).with_for_update())
        # Recheck membership/material after inference, before any concept writes.
        get_material(db, user, material_id)
        by_ordinal = {c.ordinal: c.id for c in chunks}
        for normalized, item in merge_results(results).items():
            concept = db.scalar(
                select(Concept).where(
                    Concept.course_id == material.course_id, Concept.normalized_name == normalized
                )
            )
            if concept is not None and (concept.status != "DRAFT" or concept.created_by != "AI"):
                continue  # Reviewed/user-authored content and its provenance stay untouched.
            if concept is None:
                concept = Concept(
                    course_id=material.course_id,
                    normalized_name=normalized,
                    name=item.name,
                    status="DRAFT",
                    created_by="AI",
                )
                db.add(concept)
            concept.description = item.description
            concept.aliases = item.aliases
            concept.importance = item.importance
            db.flush()
            for ordinal in sorted(set(item.source_chunk_ordinals)):
                key = (concept.id, by_ordinal[ordinal])
                if db.get(ConceptChunk, key) is None:
                    db.add(
                        ConceptChunk(concept_id=concept.id, material_chunk_id=by_ordinal[ordinal])
                    )
        job.status = "SUCCEEDED"
        job.completed_at = datetime.now(UTC)
        db.commit()
    except Exception as exc:
        db.rollback()
        failed_job = db.get(AIJob, job_id)
        if failed_job is None:
            raise HTTPException(404, "AI job no longer exists") from None
        failed_job.status = "FAILED"
        failed_job.error_code = exc.code if isinstance(exc, AIError) else "PROCESSING_FAILURE"
        failed_job.error_message = (
            "Concept extraction failed. Check the local AI service and model, then retry."
        )
        failed_job.completed_at = datetime.now(UTC)
        db.commit()
    return job_detail(db, user, job_id)
