"""Stage 5, verify: an independent model answers each question without its key.

The verifier (a different model family from the generator) gets each question with its
options but never the key, together with the text of the one page the question cites.
The studio then compares its answer with the key deterministically, using the
application's numeric grading for numbers. Short answers are the exception: the
verifier sees the reference answer and judges whether the page supports it.

Disagreement, "not answerable from this page" and named problems become review flags in
`studio check`. Agreement between two models is not proof of correctness; the owner's
review stays the gate.

Because the verifier never sees a key, its answers also tell how many deliberately
wrong keys it would catch (`calibration`), without any further requests.
"""

import hashlib
import random
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, cast

from pydantic import BaseModel, ConfigDict, ValidationError

from studio.appschema import blanks_match, interactive_module, numeric_match, stored_spec
from studio.config import INTERACTIVE_TYPES
from studio.generate import OPTION_TYPES, StoredQuestion, UnitQuestions, questions_path
from studio.ingest import PdfPages
from studio.llm import ChatClient, LLMError
from studio.prompts import VERIFY_INTERACTIVE, VERIFY_SYSTEM, VERIFY_VERSION, verify_user
from studio.store import unit_dir, write_json

VERIFY_FILE = "verify.json"
LETTERS = "ABCDEF"
Confidence = Literal["high", "medium", "low"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VerifyAnswer(Strict):
    question: str
    answerable: bool
    choice: list[str]
    truth: bool | None
    value: str | None
    reference_supported: bool | None
    confidence: Confidence
    problem: str | None
    reason: str


class VerifyBatch(Strict):
    answers: list[VerifyAnswer]


class VerifyInteractiveAnswer(VerifyAnswer):
    """Asked for only by batches with TABLE, CIRCUIT or WAVEFORM questions."""

    values: list[str] | None


class VerifyInteractiveBatch(Strict):
    answers: list[VerifyInteractiveAnswer]


class Verdict(Strict):
    id: str
    answerable: bool
    choice: list[str]
    truth: bool | None
    value: str | None
    reference_supported: bool | None
    # TABLE, CIRCUIT, WAVEFORM: one value per blank; absent from earlier files.
    values: list[str] | None = None
    # None when the verifier could not answer.
    agrees: bool | None
    confidence: Confidence
    problem: str | None
    reason: str


class BatchRecord(Strict):
    index: int
    ids: list[str]
    error: str | None


class UnitVerify(Strict):
    version: Literal["studio-verify-v1"]
    unit: str
    questions_hash: str
    model: str
    prompt_version: str
    verified_at: str
    batches: list[BatchRecord]
    verdicts: list[Verdict]

    @property
    def complete(self) -> bool:
        return all(b.error is None for b in self.batches)


@dataclass(frozen=True)
class VerifyResult:
    verify: UnitVerify
    state: Literal["unchanged", "verified", "partial"]
    calls: int


def questions_hash(studio_dir: Path, unit_id: str) -> str:
    return hashlib.sha256(questions_path(studio_dir, unit_id).read_bytes()).hexdigest()


def verify_path(studio_dir: Path, unit_id: str) -> Path:
    return unit_dir(studio_dir, unit_id) / VERIFY_FILE


def load_verify(studio_dir: Path, unit_id: str) -> UnitVerify | None:
    try:
        text = verify_path(studio_dir, unit_id).read_text(encoding="utf-8")
        return UnitVerify.model_validate_json(text)
    except (OSError, ValidationError, ValueError):
        return None


def fresh_verify(studio_dir: Path, unit_id: str) -> UnitVerify | None:
    """The unit's verification, only when it covers the current questions file."""
    verify = load_verify(studio_dir, unit_id)
    if verify is None or verify.questions_hash != questions_hash(studio_dir, unit_id):
        return None
    return verify


def verifiable(question: StoredQuestion) -> bool:
    return question.schema_error is None and question.source is not None


def plan_batches(questions: UnitQuestions, size: int) -> list[list[StoredQuestion]]:
    """Consecutive questions of one generation window, at most `size` per request."""
    batches: list[list[StoredQuestion]] = []
    for question in (q for q in questions.questions if verifiable(q)):
        last = batches[-1] if batches else None
        if last and last[0].window == question.window and len(last) < size:
            last.append(question)
        else:
            batches.append([question])
    return batches


def key_letters(content: dict[str, Any]) -> list[str]:
    return [LETTERS[i] for i, o in enumerate(content.get("options") or []) if o["is_correct"]]


def blind(question: StoredQuestion, local_id: str, page_label: str) -> dict[str, object]:
    """The question as the verifier sees it: never the key of an objective question."""
    content = question.content
    shown: dict[str, object] = {
        "question": local_id,
        "page": page_label,
        "type": content["type"],
        "stem": content["stem"],
    }
    if content["type"] in OPTION_TYPES:
        shown["options"] = [
            {"letter": LETTERS[i], "text": o["text"]} for i, o in enumerate(content["options"])
        ]
    if content["type"] == "SHORT_ANSWER":
        shown["reference_answer"] = content["reference_answer"]
    if content["type"] == "NUMERIC" and content.get("unit"):
        shown["unit"] = content["unit"]
    if content["type"] in INTERACTIVE_TYPES:
        shown["layout"] = interactive_module().public_spec(content["type"], stored_spec(content))
        if content.get("expr"):
            shown["expr"] = content["expr"]
    return shown


def letters(answer: VerifyAnswer) -> list[str]:
    return sorted({c.strip().upper().rstrip(").") for c in answer.choice if c.strip()})


def agreement(question: StoredQuestion, answer: VerifyAnswer) -> bool | None:
    if not answer.answerable:
        return None
    content = question.content
    kind = content["type"]
    if kind in OPTION_TYPES:
        chosen = letters(answer)
        return (chosen == key_letters(content)) if chosen else None
    if kind == "TRUE_FALSE":
        return None if answer.truth is None else answer.truth == content["correct_answer"]
    if kind == "NUMERIC":
        return None if answer.value is None else numeric_match(answer.value, content)
    if kind in INTERACTIVE_TYPES:
        values = getattr(answer, "values", None)
        return None if not values else blanks_match(list(values), content)
    return answer.reference_supported


def page_text(docs: dict[str, PdfPages], pdf: str, page: int) -> str:
    found = docs[pdf].pages[page - 1]
    return found.body or found.text


def verdict(question: StoredQuestion, answer: VerifyAnswer) -> Verdict:
    return Verdict(
        id=question.id,
        answerable=answer.answerable,
        choice=letters(answer),
        truth=answer.truth,
        value=answer.value,
        reference_supported=answer.reference_supported,
        values=getattr(answer, "values", None),
        agrees=agreement(question, answer),
        confidence=answer.confidence,
        problem=(answer.problem or "").strip() or None,
        reason=answer.reason.strip(),
    )


def verify_batch(
    batch: list[StoredQuestion], docs: dict[str, PdfPages], client: ChatClient, subject: str
) -> tuple[list[Verdict], str | None]:
    labels: dict[tuple[str, int], str] = {}
    pages: list[tuple[str, str]] = []
    shown = []
    local: dict[str, StoredQuestion] = {}
    for n, question in enumerate(batch, start=1):
        assert question.source is not None
        where = (question.source.pdf, question.source.page)
        if where not in labels:
            labels[where] = f"P{len(labels) + 1}"
            pages.append((labels[where], page_text(docs, *where)))
        local[f"q{n}"] = question
        shown.append(blind(question, f"q{n}", labels[where]))
    interactive = any(q.content["type"] in INTERACTIVE_TYPES for q in batch)
    reply = cast(
        VerifyBatch | VerifyInteractiveBatch,
        client.complete_json(
            system=VERIFY_SYSTEM + VERIFY_INTERACTIVE if interactive else VERIFY_SYSTEM,
            user=verify_user(pages, shown),
            response_model=VerifyInteractiveBatch if interactive else VerifyBatch,
            prompt_version=VERIFY_VERSION,
            subject=subject,
        ),
    )
    verdicts: dict[str, Verdict] = {}
    for answer in reply.answers:
        asked = local.get(answer.question.strip())
        if asked is not None and asked.id not in verdicts:
            verdicts[asked.id] = verdict(asked, answer)
    missing = len(batch) - len(verdicts)
    ordered = [verdicts[q.id] for q in batch if q.id in verdicts]
    return ordered, (f"MISSING_ANSWERS: {missing}" if missing else None)


def verify_unit(
    *,
    questions: UnitQuestions,
    docs: dict[str, PdfPages],
    client: ChatClient,
    studio_dir: Path,
    batch_size: int,
    force: bool = False,
) -> VerifyResult:
    digest = questions_hash(studio_dir, questions.unit)
    previous = None if force else load_verify(studio_dir, questions.unit)
    if previous is not None and (
        previous.questions_hash != digest
        or previous.model != client.stage.model
        or previous.prompt_version != VERIFY_VERSION
    ):
        previous = None
    if previous is not None and previous.complete:
        return VerifyResult(previous, "unchanged", 0)
    done = {v.id: v for v in previous.verdicts} if previous else {}
    ok_batches = {tuple(b.ids) for b in previous.batches if b.error is None} if previous else set()

    records: list[BatchRecord] = []
    verdicts: list[Verdict] = []
    calls = 0
    for index, batch in enumerate(plan_batches(questions, batch_size), start=1):
        ids = [q.id for q in batch]
        record = BatchRecord(index=index, ids=ids, error=None)
        if tuple(ids) in ok_batches:
            verdicts += [done[i] for i in ids if i in done]
        else:
            calls += 1
            try:
                new, record.error = verify_batch(
                    batch, docs, client, f"unit {questions.unit} batch {index}"
                )
            except LLMError as exc:
                record.error = exc.code
            else:
                verdicts += new
        records.append(record)

    result = UnitVerify(
        version="studio-verify-v1",
        unit=questions.unit,
        questions_hash=digest,
        model=client.stage.model,
        prompt_version=VERIFY_VERSION,
        verified_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        batches=records,
        verdicts=verdicts,
    )
    write_json(verify_path(studio_dir, questions.unit), result)
    return VerifyResult(result, "verified" if result.complete else "partial", calls)


@dataclass(frozen=True)
class Calibration:
    objective: int
    agreed: int
    caught: int


def seeded_key(question: StoredQuestion) -> list[str] | bool | None:
    """A deterministic wrong key for an objective question; None for other types."""
    content = question.content
    rng = random.Random(int(hashlib.sha256(question.id.encode()).hexdigest()[:16], 16))
    if content["type"] == "TRUE_FALSE":
        return not content["correct_answer"]
    if content["type"] == "MULTIPLE_CHOICE":
        wrong = [i for i, o in enumerate(content["options"]) if not o["is_correct"]]
        return [LETTERS[rng.choice(wrong)]] if wrong else None
    if content["type"] == "MULTIPLE_SELECT":
        flipped = set(key_letters(content)) ^ {LETTERS[rng.randrange(len(content["options"]))]}
        return sorted(flipped) or None
    return None


def calibration(questions: UnitQuestions, verify: UnitVerify) -> Calibration:
    """How often the verifier would flag a question whose key was swapped for a wrong one.

    Valid only because the verifier never sees objective keys: its answer is the same
    whichever key is stored, so a seeded wrong key is caught unless the verifier chose
    exactly that wrong answer without naming a problem.
    """
    by_id = {q.id: q for q in questions.questions}
    objective = agreed = caught = 0
    for v in verify.verdicts:
        question = by_id.get(v.id)
        wrong = seeded_key(question) if question else None
        if question is None or wrong is None:
            continue
        objective += 1
        agreed += v.agrees is True
        answer = v.truth if question.content["type"] == "TRUE_FALSE" else v.choice
        fooled = v.answerable and answer == wrong and v.problem is None
        caught += not fooled
    return Calibration(objective, agreed, caught)
