import json
from datetime import UTC, datetime
from time import perf_counter
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import Course, User
from app.models.ai_job import AIJob, AIUsage
from app.models.material_chunk import MaterialChunk
from app.models.question import Question, QuestionChunk, QuestionConcept
from app.schemas.concept import JobDetail
from app.schemas.question import GeneratedQuestions, GenerationRequest, content_adapter, normalize
from app.schemas.retrieval import SearchHit, SearchRequest
from app.services import retrieval
from app.services.ai.base import AIError, AIProvider, Generation
from app.services.ai.prompts.questions import PROMPT_VERSION, SYSTEM_PROMPT
from app.services.ai.service import generate_validated
from app.services.concepts.service import job_detail
from app.services.courses import get_owner_course
from app.services.embeddings.base import EmbeddingProvider
from app.services.questions.service import (
    add_version,
    save_content,
    validate_concepts,
    validate_sources,
)


def generate_questions(
    db: Session,
    user: User,
    course_id: UUID,
    request: GenerationRequest,
    provider: AIProvider,
    embeddings: EmbeddingProvider,
    settings: Settings,
) -> JobDetail:
    get_owner_course(db, user, course_id)
    if (
        request.count > settings.question_generation_max_count
        or len(request.concept_ids) > settings.question_generation_max_concepts
        or request.retrieval_top_k > settings.question_generation_retrieval_top_k_max
    ):
        raise HTTPException(422, "Question generation exceeds configured limits")
    concepts = validate_concepts(db, course_id, request.concept_ids)
    concept_content = [(c.id, c.name, c.description) for c in concepts]
    sources: dict[UUID, SearchHit] = {}
    for concept in concepts:
        query = f"{concept.name} {(concept.description or '')[:700]}".strip()
        hits = retrieval.search(
            db,
            user,
            course_id,
            SearchRequest(query=query, top_k=request.retrieval_top_k),
            embeddings,
        )
        if not hits:
            raise HTTPException(409, "No current embedded sources; embed READY materials first")
        sources.update({hit.chunk_id: hit for hit in hits})
    ordered = sorted(sources.values(), key=lambda hit: (hit.material_id, hit.ordinal, hit.chunk_id))
    if len(ordered) > settings.question_generation_max_context_chunks:
        raise HTTPException(422, "Retrieved context exceeds chunk limit; reduce selection or top_k")
    validate_sources(db, course_id, list(sources))
    concept_map = {f"C{index + 1}": concept.id for index, concept in enumerate(concepts)}
    source_map = {f"S{index + 1}": hit.chunk_id for index, hit in enumerate(ordered)}
    payload = {
        "count": request.count,
        "types": sorted(request.question_types),
        "concepts": [
            {"ref": ref, "name": concept.name, "description": concept.description}
            for ref, concept in zip(concept_map, concepts, strict=True)
        ],
        "sources": [
            {"ref": ref, "text": hit.content} for ref, hit in zip(source_map, ordered, strict=True)
        ],
    }
    prompt = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    if len(prompt) > settings.question_generation_max_context_chars:
        raise HTTPException(
            422, "Retrieved context exceeds character limit; reduce selection or top_k"
        )
    job = AIJob(
        course_id=course_id,
        requested_by_user_id=user.id,
        operation="QUESTION_GENERATION",
        provider=provider.name,
        model=provider.model,
        prompt_version=PROMPT_VERSION,
        status="RUNNING",
        input_concept_ids=[str(c.id) for c in concepts],
        input_chunk_ids=[str(h.chunk_id) for h in ordered],
        input_chunk_count=len(ordered),
        input_char_count=sum(len(h.content) for h in ordered),
        batch_count=1,
    )
    db.add(job)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An AI operation is already running for this course") from None
    job_id = job.id
    generation: Generation | None = None
    started = perf_counter()
    try:
        try:
            result, generation = generate_validated(
                provider, SYSTEM_PROMPT, prompt, GeneratedQuestions
            )
        except AIError as exc:
            generation = exc.generation
            raise
        finally:
            prompt_tokens = generation.prompt_tokens if generation else None
            completion_tokens = generation.completion_tokens if generation else None
            total = generation.total_tokens if generation else None
            if total is None and prompt_tokens is not None and completion_tokens is not None:
                total = prompt_tokens + completion_tokens
            db.add(
                AIUsage(
                    ai_job_id=job_id,
                    batch_ordinal=0,
                    provider=(generation.routed_provider if generation else None) or provider.name,
                    model=(generation.routed_model if generation else None) or provider.model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    total_tokens=total,
                    latency_ms=int((perf_counter() - started) * 1000),
                    estimated_cost=0,
                )
            )
            db.commit()
        if len(result.questions) != request.count:
            raise AIError("INVALID_COUNT")
        stems = [normalize(q.stem) for q in result.questions]
        if len(set(stems)) != len(stems):
            raise AIError("DUPLICATE_QUESTION")
        for item in result.questions:
            if item.type not in request.question_types:
                raise AIError("INVALID_TYPE")
            if (
                not set(item.concept_refs) <= concept_map.keys()
                or not set(item.source_refs) <= source_map.keys()
            ):
                raise AIError("INVALID_PROVENANCE")
        # Share the existing course lock with concept review/final merge; inference is outside it.
        db.scalar(select(Course).where(Course.id == course_id).with_for_update())
        get_owner_course(db, user, course_id)
        current_concepts = validate_concepts(db, course_id, request.concept_ids)
        if [(c.id, c.name, c.description) for c in current_concepts] != concept_content:
            raise AIError("STALE_CONCEPTS")
        validate_sources(db, course_id, list(sources))
        # Lock source rows and reject a source edit during inference rather than mis-citing it.
        current = list(
            db.scalars(
                select(MaterialChunk)
                .where(MaterialChunk.id.in_(sources))
                .order_by(MaterialChunk.id)
                .with_for_update(read=True)
                .execution_options(populate_existing=True)
            )
        )
        if len(current) != len(sources) or any(
            row.content != sources[row.id].content for row in current
        ):
            raise AIError("STALE_SOURCES")
        if db.scalar(
            select(Question.id)
            .where(
                Question.course_id == course_id,
                Question.status != "ARCHIVED",
                Question.normalized_stem.in_(stems),
            )
            .limit(1)
        ):
            raise AIError("DUPLICATE_QUESTION")
        for item in result.questions:
            content = content_adapter.validate_python(
                item.model_dump(exclude={"concept_refs", "source_refs"})
            )
            question = Question(
                id=uuid4(),
                course_id=course_id,
                created_by_user_id=user.id,
                ai_job_id=job_id,
                type=item.type,
                status="DRAFT",
                source="AI",
            )
            db.add(question)
            save_content(db, question, content)
            for ref in sorted(set(item.concept_refs)):
                db.add(QuestionConcept(question_id=question.id, concept_id=concept_map[ref]))
            for ref in sorted(set(item.source_refs)):
                db.add(QuestionChunk(question_id=question.id, chunk_id=source_map[ref]))
            add_version(db, question, user, "CREATED")
        job.status = "SUCCEEDED"
        job.completed_at = datetime.now(UTC)
        db.commit()
    except Exception as exc:
        db.rollback()
        failed = db.get(AIJob, job_id)
        if failed is None:
            raise HTTPException(404, "AI job no longer exists") from None
        failed.status = "FAILED"
        failed.error_code = exc.code if isinstance(exc, AIError) else "PROCESSING_FAILURE"
        failed.error_message = "Question generation failed. Check sources and provider, then retry."
        failed.completed_at = datetime.now(UTC)
        db.commit()
    return job_detail(db, user, job_id)
