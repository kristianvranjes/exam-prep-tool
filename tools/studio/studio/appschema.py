"""The application's own question import schemas, loaded from this repository's backend.

`app.schemas.question` depends only on Pydantic and `app.services.numbers`, so the studio
loads it straight from `backend/` without installing the backend. A question the studio
accepts is therefore exactly one the application's quiz import accepts, and a schema
change in the application shows up in the studio's tests.
"""

import importlib
import sys
from functools import cache
from pathlib import Path
from types import ModuleType
from typing import Any

from pydantic import ValidationError

from studio.config import StudioError

BACKEND = Path(__file__).resolve().parents[3] / "backend"
IMPORT_VERSION = "quiz-import-v2"


@cache
def question_module() -> ModuleType:
    if not (BACKEND / "app" / "schemas" / "question.py").is_file():
        raise StudioError(
            f"application schemas not found under {BACKEND}; "
            "install the studio from an ExamPrep checkout (pip install -e tools/studio)"
        )
    if str(BACKEND) not in sys.path:
        sys.path.append(str(BACKEND))
    module = importlib.import_module("app.schemas.question")
    origin = Path(module.__file__ or "").resolve()
    if not origin.is_relative_to(BACKEND):
        raise StudioError(f"`app` resolves to {origin}, not to {BACKEND}")
    return module


def numeric_match(answer: str, content: dict[str, object]) -> bool:
    """The application's own numeric grading: its parser and tolerance rule."""
    question_module()  # puts backend/ on the path
    numbers = importlib.import_module("app.services.numbers")
    try:
        value = numbers.parse_number(answer)
        key = numbers.parse_number(str(content["correct_value"]))
        absolute, relative = (
            numbers.parse_number(str(content[name])) if content.get(name) is not None else None
            for name in ("absolute_tolerance", "relative_tolerance")
        )
    except (ValueError, KeyError):
        return False
    return bool(numbers.within_tolerance(value, key, absolute, relative))


def interactive_module() -> ModuleType:
    """The application's helpers for TABLE, CIRCUIT and WAVEFORM specs."""
    question_module()  # puts backend/ on the path
    return importlib.import_module("app.services.interactive")


def stored_spec(content: dict[str, object]) -> dict[str, Any] | None:
    """The spec of an interactive question as the application stores it, or None."""
    module = interactive_module()
    field = module.SPEC_FIELD.get(str(content.get("type")))
    if field is None:
        return None
    try:
        question = question_module().content_adapter.validate_python(content)
    except ValidationError:
        return None
    spec: dict[str, Any] = getattr(question, field).model_dump(mode="json", exclude_none=True)
    return spec


def blanks_match(values: list[str | None], content: dict[str, object]) -> bool:
    """The application's own grading of a blanks answer: every blank right, or for a
    circuit, gates that compute the key's outputs."""
    spec = stored_spec(content)
    module = interactive_module()
    kind = str(content["type"])
    if spec is None or not module.fits(kind, spec, values) or None in values:
        return False
    if kind == "CIRCUIT":
        return bool(module.computes_key(spec, values))
    fold = importlib.import_module("app.schemas.interactive").fold
    key = module.blank_key(kind, spec)
    return all(fold(str(v)) == fold(k) for v, k in zip(values, key, strict=True))


def first_error(exc: ValidationError) -> str:
    error = exc.errors()[0]
    where = ".".join(str(part) for part in error["loc"])
    return f"{where}: {error['msg']}" if where else str(error["msg"])


def content_error(content: dict[str, object]) -> str | None:
    """None when the application would import this question, otherwise the first problem."""
    try:
        question_module().content_adapter.validate_python(content)
    except ValidationError as exc:
        return first_error(exc)
    return None


def import_error(document: dict[str, object]) -> str | None:
    """None when the whole document is a valid quiz import file."""
    try:
        question_module().QuizImport.model_validate(document)
    except ValidationError as exc:
        return first_error(exc)
    return None
