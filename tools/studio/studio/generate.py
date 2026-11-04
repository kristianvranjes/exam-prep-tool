"""Stage 3, questions: generate a unit's questions to its blueprint.

A unit's pages are split into windows of consecutive pages, bounded in characters and in
questions per request, and the blueprint is shared out across windows in proportion to
their text. Each request sees only its window. Pages carry prompt-local labels (S1, S2,
...) that are mapped back to PDF and page here, so a model can only cite a page it was
shown. Options are reordered deterministically. Every question is validated with the
application's own import schema; a failure is recorded on the question, never repaired.

A unit whose inputs (pages, blueprint, model, prompt version) are unchanged is not sent
again. When some windows failed, a rerun requests only those.
"""

import hashlib
import json
import math
import random
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from studio.appschema import content_error
from studio.config import QUESTION_TYPES, Questions, QuestionType, StudioError, TypeCounts
from studio.course import Unit
from studio.ingest import PdfPages
from studio.llm import ChatClient, LLMError
from studio.prompts import QUESTIONS_SYSTEM, QUESTIONS_VERSION, questions_user
from studio.store import unit_dir, write_json

QUESTIONS_FILE = "questions.json"
FileVersion = Literal["studio-questions-v1"]
OPTION_TYPES = frozenset({"MULTIPLE_CHOICE", "MULTIPLE_SELECT"})


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# The response schema is flat rather than a discriminated union: strict structured
# output on several providers does not support oneOf. The application schema below
# then checks each question in its real shape.
class GenOption(Strict):
    text: str
    is_correct: bool


class GenQuestion(Strict):
    type: QuestionType
    stem: str
    options: list[GenOption]
    correct_answer: bool | None
    reference_answer: str | None
    correct_value: str | None
    absolute_tolerance: str | None
    relative_tolerance: str | None
    unit: str | None
    explanation: str
    difficulty: int
    source: str
    quote: str


class GenBatch(Strict):
    questions: list[GenQuestion]


class PageText(Strict):
    pdf: str
    page: int
    text: str


class Source(Strict):
    pdf: str
    page: int
    quote: str


class StoredQuestion(Strict):
    id: str
    window: int
    content: dict[str, Any]
    source: Source | None
    schema_error: str | None


class WindowRecord(Strict):
    index: int
    pages: list[str]
    chars: int
    requested: TypeCounts
    received: int
    error: str | None


class UnitQuestions(Strict):
    version: FileVersion
    unit: str
    title: str
    prompt_version: str
    model: str
    input_hash: str
    generated_at: str
    windows: list[WindowRecord]
    questions: list[StoredQuestion]

    @property
    def complete(self) -> bool:
        return all(w.error is None for w in self.windows)


@dataclass(frozen=True)
class Window:
    index: int
    pages: list[PageText]
    counts: TypeCounts

    @property
    def chars(self) -> int:
        return sum(len(p.text) for p in self.pages)

    @property
    def labelled(self) -> list[tuple[str, PageText]]:
        return [(f"S{i}", page) for i, page in enumerate(self.pages, start=1)]


@dataclass(frozen=True)
class UnitResult:
    questions: UnitQuestions
    state: Literal["unchanged", "generated", "partial"]
    calls: int


def unit_counts(unit: Unit, blueprint: Questions) -> TypeCounts:
    return dict(unit.questions or blueprint.types)


def unit_pages(unit: Unit, docs: dict[str, PdfPages], max_chars: int) -> list[PageText]:
    pages = []
    for source in unit.sources:
        doc = docs.get(source.pdf)
        if doc is None:
            raise StudioError(f"unit {unit.id}: {source.pdf!r} is not ingested")
        start, end = source.bounds
        for page in doc.pages[start - 1 : end]:
            if "no_text" not in page.flags and page.body.strip():
                pages.append(PageText(pdf=doc.slug, page=page.page, text=page.body[:max_chars]))
    return pages


def apportion(total: int, weights: list[int]) -> list[int]:
    """Split total into integer shares proportional to weights (largest remainder)."""
    if not weights:
        return []
    if sum(weights) == 0:
        weights = [1] * len(weights)
    exact = [total * w / sum(weights) for w in weights]
    shares = [math.floor(x) for x in exact]
    by_remainder = sorted(range(len(weights)), key=lambda i: (-(exact[i] - shares[i]), i))
    for i in by_remainder[: total - sum(shares)]:
        shares[i] += 1
    return shares


def plan_windows(pages: list[PageText], counts: TypeCounts, blueprint: Questions) -> list[Window]:
    if not pages:
        return []
    total_chars = sum(len(p.text) for p in pages)
    wanted = max(
        1,
        math.ceil(total_chars / blueprint.max_input_chars),
        math.ceil(sum(counts.values()) / blueprint.max_questions_per_call),
    )
    wanted = min(wanted, len(pages))
    target = total_chars / wanted
    groups: list[list[PageText]] = [[]]
    size = 0
    for page in pages:
        full = size + len(page.text) > blueprint.max_input_chars
        if groups[-1] and (full or size >= target):
            groups.append([])
            size = 0
        groups[-1].append(page)
        size += len(page.text)

    sizes = [sum(len(p.text) for p in group) for group in groups]
    per_type = {t: apportion(counts.get(t, 0), sizes) for t in QUESTION_TYPES}
    return [
        Window(
            index=i + 1,
            pages=group,
            counts={t: per_type[t][i] for t in QUESTION_TYPES if per_type[t][i]},
        )
        for i, group in enumerate(groups)
    ]


def input_hash(windows: list[Window], counts: TypeCounts, model: str) -> str:
    payload = {
        "prompt": QUESTIONS_VERSION,
        "system": hashlib.sha256(QUESTIONS_SYSTEM.encode()).hexdigest(),
        "model": model,
        "counts": counts,
        "windows": [[w.counts, [[p.pdf, p.page, p.text] for p in w.pages]] for w in windows],
    }
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def to_content(question: GenQuestion) -> dict[str, Any]:
    """The application's import shape: only the fields the question's type uses."""
    content: dict[str, Any] = {
        "type": question.type,
        "stem": question.stem.strip(),
        "explanation": question.explanation.strip() or None,
        "difficulty": question.difficulty,
    }
    if question.type in OPTION_TYPES:
        content["options"] = [
            {"text": o.text.strip(), "is_correct": o.is_correct} for o in question.options
        ]
    elif question.type == "TRUE_FALSE":
        content["correct_answer"] = question.correct_answer
    elif question.type == "SHORT_ANSWER":
        content["reference_answer"] = question.reference_answer
    else:
        content["correct_value"] = question.correct_value
        for name in ("absolute_tolerance", "relative_tolerance", "unit"):
            if (value := getattr(question, name)) is not None:
                content[name] = value
    return content


def questions_path(studio_dir: Path, unit_id: str) -> Path:
    return unit_dir(studio_dir, unit_id) / QUESTIONS_FILE


def load_questions(studio_dir: Path, unit_id: str) -> UnitQuestions | None:
    path = questions_path(studio_dir, unit_id)
    if not path.is_file():
        return None
    try:
        return UnitQuestions.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValidationError, ValueError):
        return None


def shuffle_options(content: dict[str, Any], seed: str) -> None:
    """Reorder options deterministically, seeded by the question id.

    Models put the key first far more often than chance (10 of 12 in the first SRS
    run), and the application shows options in stored order. Reordering changes no
    content; the answer_position check still reports any remaining skew.
    """
    if content["type"] in OPTION_TYPES:
        rng = random.Random(int(hashlib.sha256(seed.encode()).hexdigest()[:16], 16))
        rng.shuffle(content["options"])


def stored(unit: Unit, window: Window, batch: GenBatch) -> list[StoredQuestion]:
    pages = dict(window.labelled)
    result = []
    for k, question in enumerate(batch.questions, start=1):
        qid = f"{unit.id}-w{window.index:02d}-{k:02d}"
        page = pages.get(question.source.strip().upper())
        content = to_content(question)
        shuffle_options(content, qid)
        result.append(
            StoredQuestion(
                id=qid,
                window=window.index,
                content=content,
                source=(
                    Source(pdf=page.pdf, page=page.page, quote=question.quote.strip())
                    if page
                    else None
                ),
                schema_error=content_error(content),
            )
        )
    return result


def generate_unit(
    *,
    course_name: str,
    unit: Unit,
    docs: dict[str, PdfPages],
    blueprint: Questions,
    client: ChatClient,
    studio_dir: Path,
    force: bool = False,
) -> UnitResult:
    counts = unit_counts(unit, blueprint)
    pages = unit_pages(unit, docs, blueprint.max_input_chars)
    if not pages:
        raise StudioError(f"unit {unit.id} has no pages with text")
    windows = plan_windows(pages, counts, blueprint)
    digest = input_hash(windows, counts, client.stage.model)

    previous = None if force else load_questions(studio_dir, unit.id)
    if previous is not None and previous.input_hash != digest:
        previous = None
    if previous is not None and previous.complete:
        return UnitResult(previous, "unchanged", 0)
    kept = {w.index for w in previous.windows if w.error is None} if previous else set()

    records: list[WindowRecord] = []
    questions: list[StoredQuestion] = []
    calls = 0
    for window in windows:
        record = WindowRecord(
            index=window.index,
            pages=[f"{p.pdf}:{p.page}" for p in window.pages],
            chars=window.chars,
            requested=window.counts,
            received=0,
            error=None,
        )
        if previous is not None and window.index in kept:
            reused = [q for q in previous.questions if q.window == window.index]
            record.received = len(reused)
            questions += reused
        elif window.counts:
            calls += 1
            try:
                batch = client.complete_json(
                    system=QUESTIONS_SYSTEM,
                    user=questions_user(
                        course_name,
                        unit.title,
                        window.counts,
                        [(label, page.text) for label, page in window.labelled],
                    ),
                    response_model=GenBatch,
                    prompt_version=QUESTIONS_VERSION,
                    subject=f"unit {unit.id} window {window.index}",
                )
            except LLMError as exc:
                record.error = exc.code
            else:
                new = stored(unit, window, batch)
                record.received = len(new)
                questions += new
        records.append(record)

    result = UnitQuestions(
        version="studio-questions-v1",
        unit=unit.id,
        title=unit.title,
        prompt_version=QUESTIONS_VERSION,
        model=client.stage.model,
        input_hash=digest,
        generated_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        windows=records,
        questions=questions,
    )
    write_json(questions_path(studio_dir, unit.id), result)
    return UnitResult(result, "generated" if result.complete else "partial", calls)
