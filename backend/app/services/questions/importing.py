import json
from dataclasses import dataclass, field
from uuid import UUID, uuid4

from fastapi import HTTPException, Request
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import User
from app.models.course_unit import CourseUnit
from app.models.question import Question
from app.schemas.question import (
    CLASSIC_TYPES,
    ImportContent,
    ImportUnitTitle,
    OwnerQuestion,
    QuizImport,
    import_content_adapter,
    normalize,
)
from app.schemas.question_import import (
    DuplicatePolicy,
    ImportAs,
    ImportIssue,
    ImportItemReport,
    ImportReport,
    IssueCode,
    Severity,
)
from app.services.course_units import replace_question_units, validate_unit_links
from app.services.courses import get_member_course
from app.services.questions.service import (
    add_version,
    apply_transition,
    owner_view,
    save_content,
)

VERSIONS = ("quiz-import-v1", "quiz-import-v2")
DOCUMENT_FIELDS = {"version", "unit", "questions"}
unit_title_adapter: TypeAdapter[ImportUnitTitle | None] = TypeAdapter(ImportUnitTitle | None)


def format_errors(exc: ValidationError) -> str:
    # Return useful field paths without echoing study content or arbitrary input.
    errors = exc.errors(include_input=False, include_context=False, include_url=False)
    return "; ".join(
        f"{'.'.join(map(str, e['loc'])) or 'document'}: {e['msg']}" for e in errors[:5]
    )


async def read_body(request: Request) -> bytes:
    """The raw upload, bounded before any parsing."""
    settings = Settings()
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
        raise HTTPException(415, "Send the quiz file as application/json")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > settings.question_import_max_bytes:
            raise HTTPException(413, "Quiz import exceeds configured byte limit")
        body.extend(chunk)
    return bytes(body)


async def read_import(request: Request, skip_invalid: bool = False) -> QuizImport:
    """The document to import; `skip_invalid` leaves out questions that fail their checks."""
    body = await read_body(request)
    settings = Settings()
    if skip_invalid:
        try:
            parsed = parse_document(body, settings.question_import_max_count)
        except Unreadable as exc:
            raise HTTPException(422, str(exc)) from None
        valid = [item.content for item in parsed.items if item.content and not item.errors()]
        if not valid:
            raise HTTPException(422, "No question in the file can be imported")
        return QuizImport.model_validate(
            {"version": parsed.version, "unit": parsed.unit, "questions": valid}
        )
    try:
        document = QuizImport.model_validate_json(body)
    except ValidationError as exc:
        raise HTTPException(422, format_errors(exc)) from None
    if len(document.questions) > settings.question_import_max_count:
        raise HTTPException(422, "Quiz import exceeds configured question limit")
    return document


class Unreadable(Exception):
    """The file as a whole cannot be read, so no question can be reported on."""


@dataclass
class Item:
    position: int
    line: int | None
    raw: object
    content: ImportContent | None = None
    issues: list[ImportIssue] = field(default_factory=list)

    def add(self, code: IssueCode, severity: Severity, message: str) -> None:
        self.issues.append(ImportIssue(code=code, severity=severity, message=message))

    def errors(self) -> list[ImportIssue]:
        return [issue for issue in self.issues if issue.severity == "ERROR"]


@dataclass
class Parsed:
    version: str
    unit: str | None
    items: list[Item]


def question_lines(text: str) -> list[int]:
    """Line (1-based) on which each element of the top-level `questions` array starts."""
    lines: list[int] = []
    stack: list[str] = []
    line = 1
    in_string = escaped = False
    for char in text:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            elif char == "\n":
                line += 1
        elif char == '"':
            in_string = True
        elif char == "\n":
            line += 1
        elif char in "{[":
            if stack == ["{", "["]:
                lines.append(line)
            stack.append(char)
        elif char in "}]" and stack:
            stack.pop()
    return lines


def parse_document(body: bytes, max_count: int) -> Parsed:
    """Read a file question by question, so one bad question does not hide the others."""
    try:
        text = body.decode("utf-8")
        data = json.loads(text)
    except ValueError:
        raise Unreadable("The file is not valid UTF-8 JSON") from None
    if not isinstance(data, dict):
        raise Unreadable("document: expected a JSON object")
    unknown = sorted(set(data) - DOCUMENT_FIELDS)
    if unknown:
        raise Unreadable(f"{unknown[0]}: unknown field")
    version = data.get("version")
    if version not in VERSIONS:
        raise Unreadable("version: use quiz-import-v1 or quiz-import-v2")
    try:
        unit = unit_title_adapter.validate_python(data.get("unit"))
    except ValidationError:
        raise Unreadable("unit: expected a title of 1 to 150 characters") from None
    if unit is not None and version == "quiz-import-v1":
        raise Unreadable("unit: use quiz-import-v2 to name units")
    questions = data.get("questions")
    if not isinstance(questions, list) or not questions:
        raise Unreadable("questions: provide at least one question")
    if len(questions) > max_count:
        raise Unreadable("questions: the file exceeds the configured question limit")
    lines: list[int | None] = list(question_lines(text))
    if len(lines) != len(questions):
        lines = [None] * len(questions)
    items = []
    first: dict[str, int] = {}
    for index, raw in enumerate(questions):
        item = Item(index + 1, lines[index], raw)
        items.append(item)
        try:
            item.content = import_content_adapter.validate_json(json.dumps(raw, ensure_ascii=False))
        except ValidationError as exc:
            item.add("INVALID_CONTENT", "ERROR", format_errors(exc))
            continue
        if version == "quiz-import-v1" and (
            item.content.type not in CLASSIC_TYPES or item.content.unit is not None
        ):
            item.add("NEEDS_V2", "ERROR", "Use quiz-import-v2 for this type or for naming a unit")
        stem = normalize(item.content.stem)
        if stem in first:
            item.add("DUPLICATE_IN_FILE", "ERROR", f"Same text as question {first[stem]}")
        else:
            first[stem] = item.position
    return Parsed(version, unit, items)


def units_by_title(db: Session, course_id: UUID) -> dict[str, CourseUnit]:
    return {
        unit.normalized_title: unit
        for unit in db.scalars(select(CourseUnit).where(CourseUnit.course_id == course_id))
    }


def check_import(db: Session, user: User, course_id: UUID, body: bytes) -> ImportReport:
    """Report on every question of a file, saving nothing."""
    get_member_course(db, user, course_id)
    try:
        parsed = parse_document(body, Settings().question_import_max_count)
    except Unreadable as exc:
        return ImportReport(readable=False, message=str(exc))
    contents = [item.content for item in parsed.items if item.content]
    stems = {normalize(content.stem) for content in contents}
    units = units_by_title(db, course_id)
    own: set[str] = set()
    approved: set[str] = set()
    if stems:
        for stem, creator, status in db.execute(
            select(Question.normalized_stem, Question.created_by_user_id, Question.status).where(
                Question.course_id == course_id,
                Question.normalized_stem.in_(stems),
                Question.status.in_(("DRAFT", "PENDING_REVIEW", "REJECTED", "APPROVED")),
            )
        ):
            if creator == user.id:
                own.add(stem)
            if status == "APPROVED":
                approved.add(stem)
    items = []
    for item in parsed.items:
        content = item.content
        raw = item.raw if isinstance(item.raw, dict) else {}
        title = None
        if content:
            title = content.unit or parsed.unit
            if title is not None:
                unit = units.get(normalize(title))
                if unit is None:
                    item.add("UNKNOWN_UNIT", "ERROR", f"The course has no unit called “{title}”")
                elif unit.is_archived:
                    item.add("ARCHIVED_UNIT", "ERROR", f"The unit “{title}” is archived")
            stem = normalize(content.stem)
            if stem in own:
                item.add("DUPLICATE_OWN", "WARNING", "You already have a question with this text")
            elif stem in approved:
                item.add("DUPLICATE_APPROVED", "WARNING", "An approved question has the same text")
            if content.explanation is None:
                item.add("NO_EXPLANATION", "WARNING", "The question has no explanation")
        else:
            title = raw.get("unit") if isinstance(raw.get("unit"), str) else None
        status = "OK"
        if any(issue.severity == "WARNING" for issue in item.issues):
            status = "WARNING"
        if item.errors():
            status = "ERROR"
        question_type = raw.get("type")
        stem_text = raw.get("stem")
        items.append(
            ImportItemReport(
                position=item.position,
                line=item.line,
                type=question_type if isinstance(question_type, str) else None,
                stem=stem_text[:400] if isinstance(stem_text, str) else None,
                unit=title,
                status=status,  # type: ignore[arg-type]
                issues=item.issues,
            )
        )
    return ImportReport(
        readable=True,
        version=parsed.version,
        total=len(items),
        ok=sum(item.status == "OK" for item in items),
        warnings=sum(item.status == "WARNING" for item in items),
        errors=sum(item.status == "ERROR" for item in items),
        items=items,
    )


def import_questions(
    db: Session,
    user: User,
    course_id: UUID,
    document: QuizImport,
    unit_ids: list[UUID] | None = None,
    duplicates: DuplicatePolicy = "REJECT",
    import_as: ImportAs = "DRAFT",
    skip_invalid: bool = False,
) -> list[OwnerQuestion]:
    """Import drafts (or questions sent straight to review) in one transaction.

    `duplicates` says what to do with a question whose text you already have: REJECT fails the
    whole import (409), SKIP leaves it out, REPLACE overwrites it while it is still a DRAFT or
    REJECTED (a question already under review or published is left as it is). With
    `skip_invalid`, a question naming an unknown or archived unit is left out instead of failing.
    """
    get_member_course(db, user, course_id)
    try:
        # The `unit_ids` selection is the default for questions that do not name a unit.
        default_units = validate_unit_links(db, course_id, unit_ids or [])
        titles = {c.unit or document.unit for c in document.questions} - {None}
        by_title = units_by_title(db, course_id) if titles else {}
        existing: dict[str, Question] = {}
        if duplicates != "REJECT":
            stems = {normalize(c.stem) for c in document.questions}
            existing = {
                question.normalized_stem: question
                for question in db.scalars(
                    select(Question)
                    .where(
                        Question.course_id == course_id,
                        Question.created_by_user_id == user.id,
                        Question.status != "ARCHIVED",
                        Question.normalized_stem.in_(stems),
                    )
                    .with_for_update()
                )
            }
        rows = []
        for content in document.questions:
            title = content.unit or document.unit
            units: list[UUID] | None = default_units
            if title is not None:
                unit = by_title.get(normalize(title))
                if unit is None or unit.is_archived:
                    if skip_invalid:
                        continue
                    raise HTTPException(422, f"Unknown or archived unit: {title}")
                units = [unit.id]
            old = existing.get(normalize(content.stem))
            if old is not None:
                if duplicates == "SKIP" or old.status not in ("DRAFT", "REJECTED"):
                    continue
                question, reason = old, "EDITED"
                question.type = content.type
                question.status = "DRAFT"
                question.reviewed_by_user_id = None
                question.reviewed_at = None
                question.rejection_reason = None
                # Replacing keeps the question's units unless the file or the request names some.
                if title is None and not unit_ids:
                    units = None
            else:
                question, reason = (
                    Question(
                        id=uuid4(),
                        course_id=course_id,
                        created_by_user_id=user.id,
                        type=content.type,
                        status="DRAFT",
                        source="USER",
                    ),
                    "CREATED",
                )
                db.add(question)
            save_content(db, question, content)
            if units is not None:
                replace_question_units(db, question.id, units)
            add_version(db, question, user, reason)
            if import_as == "PENDING_REVIEW":
                apply_transition(db, user, question, "submit")
            rows.append(owner_view(db, question))
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            409, "Duplicate active question or conflicting import; nothing saved"
        ) from None
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not import questions; nothing saved") from None
    return rows
