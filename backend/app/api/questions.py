from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.config import Settings
from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.concept import JobDetail
from app.schemas.course_unit import BulkQuestionUnits, BulkQuestionUnitsResult, QuestionUnits
from app.schemas.question import (
    BulkQuestionTransition,
    BulkQuestionTransitionResult,
    GenerationRequest,
    OwnerQuestion,
    QuestionCreate,
    QuestionPatch,
    QuestionResponse,
    QuestionStatus,
    QuestionType,
    QuizImport,
    RejectRequest,
    VersionResponse,
)
from app.services.ai.base import AIProvider
from app.services.ai.router import get_ai_provider
from app.services.embeddings.base import EmbeddingProvider
from app.services.embeddings.router import get_embedding_provider
from app.services.questions import service
from app.services.questions.generation import generate_questions
from app.services.questions.importing import import_questions, read_import

router = APIRouter(tags=["questions"])


@router.post("/courses/{course_id}/questions", response_model=OwnerQuestion, status_code=201)
def create(
    course_id: UUID,
    data: QuestionCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OwnerQuestion:
    return service.create_question(db, user, course_id, data)


@router.post(
    "/courses/{course_id}/questions/import", response_model=list[OwnerQuestion], status_code=201
)
def import_quiz(
    course_id: UUID,
    unit_ids: list[UUID] = Query(default=[], max_length=5),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    document: QuizImport = Depends(read_import),
) -> list[OwnerQuestion]:
    return import_questions(db, user, course_id, document, unit_ids)


@router.post("/courses/{course_id}/questions/generate", response_model=JobDetail)
def generate(
    course_id: UUID,
    data: GenerationRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    provider: AIProvider = Depends(get_ai_provider),
    embeddings: EmbeddingProvider = Depends(get_embedding_provider),
) -> JobDetail:
    return generate_questions(db, user, course_id, data, provider, embeddings, Settings())


@router.get("/courses/{course_id}/questions", response_model=list[QuestionResponse])
def list_questions(
    course_id: UUID,
    status: QuestionStatus | None = None,
    type: QuestionType | None = None,
    unit_id: UUID | None = None,
    unassigned: bool = False,
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[QuestionResponse]:
    return service.list_questions(
        db, user, course_id, status, type, limit, offset, unit_id, unassigned
    )


@router.get("/questions/{question_id}", response_model=QuestionResponse)
def read(
    question_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> QuestionResponse:
    return service.read_question(db, user, question_id)


@router.patch("/questions/{question_id}", response_model=OwnerQuestion)
def edit(
    question_id: UUID,
    data: QuestionPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OwnerQuestion:
    return service.edit_question(db, user, question_id, data)


@router.patch("/questions/{question_id}/units", response_model=QuestionResponse)
def set_units(
    question_id: UUID,
    data: QuestionUnits,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QuestionResponse:
    return service.set_units(db, user, question_id, data.unit_ids)


@router.post("/courses/{course_id}/questions/units", response_model=BulkQuestionUnitsResult)
def bulk_set_units(
    course_id: UUID,
    data: BulkQuestionUnits,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BulkQuestionUnitsResult:
    return service.bulk_set_units(db, user, course_id, data)


@router.post(
    "/courses/{course_id}/questions/transition", response_model=BulkQuestionTransitionResult
)
def bulk_transition(
    course_id: UUID,
    data: BulkQuestionTransition,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BulkQuestionTransitionResult:
    return service.bulk_transition(db, user, course_id, data)


@router.post("/questions/{question_id}/submit", response_model=OwnerQuestion)
def submit(
    question_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> OwnerQuestion:
    return service.transition(db, user, question_id, "submit")


@router.post("/questions/{question_id}/approve", response_model=OwnerQuestion)
def approve(
    question_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> OwnerQuestion:
    return service.transition(db, user, question_id, "approve")


@router.post("/questions/{question_id}/reject", response_model=OwnerQuestion)
def reject(
    question_id: UUID,
    data: RejectRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OwnerQuestion:
    return service.transition(db, user, question_id, "reject", data.reason)


@router.post("/questions/{question_id}/archive", response_model=OwnerQuestion)
def archive(
    question_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> OwnerQuestion:
    return service.transition(db, user, question_id, "archive")


@router.get("/questions/{question_id}/versions", response_model=list[VersionResponse])
def versions(
    question_id: UUID,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VersionResponse]:
    return [
        VersionResponse.model_validate(row)
        for row in service.versions(db, user, question_id, limit, offset)
    ]
