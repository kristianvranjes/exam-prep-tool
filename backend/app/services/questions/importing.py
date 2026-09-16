from uuid import UUID, uuid4

from fastapi import HTTPException, Request
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import User
from app.models.question import Question
from app.schemas.question import OwnerQuestion, QuizImport
from app.services.courses import get_owner_course
from app.services.questions.service import add_version, owner_view, save_content


async def read_import(request: Request) -> QuizImport:
    settings = Settings()
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
        raise HTTPException(415, "Send the quiz file as application/json")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > settings.question_import_max_bytes:
            raise HTTPException(413, "Quiz import exceeds configured byte limit")
        body.extend(chunk)
    try:
        document = QuizImport.model_validate_json(body)
    except ValidationError as exc:
        # Return useful field paths without echoing study content or arbitrary input.
        errors = exc.errors(include_input=False, include_context=False, include_url=False)
        detail = "; ".join(
            f"{'.'.join(map(str, e['loc'])) or 'document'}: {e['msg']}" for e in errors[:5]
        )
        raise HTTPException(422, detail) from None
    if len(document.questions) > settings.question_import_max_count:
        raise HTTPException(422, "Quiz import exceeds configured question limit")
    return document


def import_questions(
    db: Session, user: User, course_id: UUID, document: QuizImport
) -> list[OwnerQuestion]:
    get_owner_course(db, user, course_id)
    try:
        rows = []
        for content in document.questions:
            question = Question(
                id=uuid4(),
                course_id=course_id,
                created_by_user_id=user.id,
                type=content.type,
                status="DRAFT",
                source="USER",
            )
            db.add(question)
            save_content(db, question, content)
            add_version(db, question, user, "CREATED")
            rows.append(owner_view(db, question))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            409, "Duplicate active question or conflicting import; nothing saved"
        ) from None
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not import questions; nothing saved") from None
    return rows
