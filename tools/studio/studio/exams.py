"""Questions from past exams and question lists, sorted into the course's units.

`studio exams` reads the PDFs named in `[exams]`, marks bold text (solution sheets set
the correct option in bold) and OCRs scanned pages. The generator transcribes each
document into items and names the unit of each; construction tasks and remembered
fragments are listed, not imported. The same question from several papers becomes one
question that records every appearance. Its key comes from the bold marking when the
document marks answers; otherwise the generator decides it from the unit's
best-matching slide pages and must quote the page, which the checks and the blind
verifier then test like any generated question. The questions join their units'
`questions.json` with an `origin`, and review, publish and push treat them as usual.
"""

import ctypes
import hashlib
import json
import math
import re
import unicodedata
from collections import Counter
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c
from pydantic import BaseModel, ConfigDict, ValidationError

from studio.appschema import content_error
from studio.checks import partial_ratio
from studio.config import Exams, Sources, StudioError, resolve_sources
from studio.course import CourseFile, Unit
from studio.generate import (
    Appearance,
    ExamOrigin,
    OriginFlag,
    PageText,
    Source,
    StoredQuestion,
    UnitQuestions,
    load_questions,
    questions_path,
    unit_pages,
)
from studio.ingest import PdfPages, assign_slugs, sha256_file
from studio.llm import ChatClient, LLMError
from studio.ocr import cached_pages, ocr_pages
from studio.prompts import (
    EXTRACT_SYSTEM,
    EXTRACT_VERSION,
    KEY_SYSTEM,
    KEY_VERSION,
    extract_user,
    key_user,
)
from studio.review import current_decisions, load_review
from studio.rewrite import rewrite
from studio.sources import fold, references, strip_content
from studio.store import write_json

DOC_VERSION: Literal["studio-exam-doc-v1"] = "studio-exam-doc-v1"
MIN_TEXT_CHARS = 30  # a page with less text is scanned and goes through OCR
# Each item comes back twice (as printed and corrected), so windows stay small.
WINDOW_CHARS = 3000
PAGES_PER_QUESTION = 3
MAX_KEY_CHARS = 12000
SAME_STEM = 0.88
KEYED_SHARE = 0.7
LETTERS = "abcdefgh"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def exams_dir(studio_dir: Path) -> Path:
    return studio_dir / "build" / "exams"


def digest(*parts: object) -> str:
    encoded = json.dumps(parts, sort_keys=True, ensure_ascii=False, default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


# Reading ------------------------------------------------------------------------------


class ExamPage(Strict):
    page: int
    text: str
    ocr: bool


class ExamDoc(Strict):
    version: Literal["studio-exam-doc-v1"]
    file: str
    slug: str
    sha256: str
    pages: list[ExamPage]


def plain(ch: str) -> str:
    """Mathematical alphanumerics (bold italic I, a, 4 ...) as plain letters and digits."""
    return unicodedata.normalize("NFKC", ch) if 0x1D400 <= ord(ch) <= 0x1D7FF else ch


def mark_bold(chars: list[tuple[str, bool]]) -> str:
    """Text with each bold run wrapped in **...**; a run never crosses a line break."""
    out: list[str] = []
    bold = False
    spaces = ""  # held back until we know whether a bold run goes on after them
    for ch, is_bold in chars:
        if ch == "\r":
            continue
        if ch == "\n":
            if bold:
                out.append("**")
                bold = False
            out += [spaces, ch]
            spaces = ""
        elif ch.isspace():
            spaces += ch
        else:
            if bold and not is_bold and ch.isalnum():  # symbols such as ⟨ ⟩ stay in a run
                out.append("**")
                bold = False
            out.append(spaces)
            spaces = ""
            if is_bold and not bold:
                out.append("**")
                bold = True
            out.append(ch)
    if bold:
        out.append("**")
    return "".join(out)


def page_chars(page: pdfium.PdfPage) -> list[tuple[str, bool]]:
    """Every character of the page with whether it is set in bold."""
    textpage = page.get_textpage()
    count = pdfium_c.FPDFText_CountChars(textpage.raw)
    name = ctypes.create_string_buffer(128)
    flags = ctypes.c_int()
    chars: list[tuple[str, bool]] = []
    i = 0
    while i < count:
        code = pdfium_c.FPDFText_GetUnicode(textpage.raw, i)
        weight = pdfium_c.FPDFText_GetFontWeight(textpage.raw, i)
        pdfium_c.FPDFText_GetFontInfo(textpage.raw, i, name, len(name), ctypes.byref(flags))
        i += 1
        if 0xD800 <= code < 0xDC00 and i < count:  # a surrogate pair: one character
            low = pdfium_c.FPDFText_GetUnicode(textpage.raw, i)
            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
            i += 1
        if code == 0 or 0xD800 <= code < 0xE000:
            continue
        ch = chr(code)
        bold = weight >= 600 or b"Bold" in name.value or "BOLD" in unicodedata.name(ch, "")
        chars.extend((c, bold) for c in plain(ch))
    return chars


def read_exam(pdf: Path, slug: str, studio_dir: Path) -> ExamDoc:
    """The document's pages, bold marked; scanned pages read by OCR (both cached)."""
    sha = sha256_file(pdf)
    path = exams_dir(studio_dir) / "docs" / f"{slug}.json"
    try:
        cached = ExamDoc.model_validate_json(path.read_text(encoding="utf-8"))
        if cached.sha256 == sha:
            return cached
    except (OSError, ValidationError, ValueError):
        pass
    try:
        document = pdfium.PdfDocument(str(pdf))
    except pdfium.PdfiumError as exc:
        raise StudioError(f"cannot open {pdf.name}: {exc}") from None
    try:
        texts = [mark_bold(page_chars(document[i])).strip() for i in range(len(document))]
    finally:
        document.close()
    scanned = [n for n, t in enumerate(texts, start=1) if len(t) < MIN_TEXT_CHARS]
    read: dict[int, str] = {}
    if scanned:
        ocr_pages(pdf, f"exam-{slug}", sha, scanned, studio_dir)
        read = cached_pages(studio_dir, f"exam-{slug}", sha)
    pages = [
        ExamPage(page=n, text=read[n].strip(), ocr=True)
        if n in read
        else ExamPage(page=n, text=text, ocr=False)
        for n, text in enumerate(texts, start=1)
    ]
    doc = ExamDoc(version=DOC_VERSION, file=pdf.name, slug=slug, sha256=sha, pages=pages)
    write_json(path, doc)
    return doc


def exam_pdfs(studio_dir: Path, exams: Exams) -> list[tuple[Path, str]]:
    return assign_slugs(resolve_sources(studio_dir, Sources(pdfs=exams.pdfs)))


# Transcription ------------------------------------------------------------------------


class XOption(Strict):
    original: str
    text: str
    marked: bool


class XItem(Strict):
    number: str
    page: int
    kind: Literal["choice", "true_false", "short", "task", "incomplete"]
    original: str
    stem: str
    options: list[XOption]
    answer: str | None
    unit: str


class XBatch(Strict):
    items: list[XItem]


class ExtractWindow(Strict):
    pages: list[int]
    error: str | None


class Extracted(Strict):
    version: Literal["studio-exam-extract-v1"]
    file: str
    input_hash: str
    windows: list[ExtractWindow]
    items: list[XItem]

    @property
    def complete(self) -> bool:
        return all(w.error is None for w in self.windows)


def plan_extract(doc: ExamDoc) -> list[list[int]]:
    """Consecutive pages with text, at most WINDOW_CHARS of text per window."""
    windows: list[list[int]] = []
    size = 0
    for page in doc.pages:
        if not page.text:
            continue
        if windows and size + len(page.text) <= WINDOW_CHARS:
            windows[-1].append(page.page)
            size += len(page.text)
        else:
            windows.append([page.page])
            size = len(page.text)
    return windows


def extract_payload(doc: ExamDoc, main: list[int]) -> list[dict[str, object]]:
    """The window's pages, plus the next page so items that run over can be finished."""
    by_number = {p.page: p for p in doc.pages}
    pages: list[dict[str, object]] = [
        {"page": n, "role": "main", "text": by_number[n].text} for n in main
    ]
    after = by_number.get(main[-1] + 1)
    if after is not None and after.text:
        pages.append({"page": after.page, "role": "context", "text": after.text})
    return pages


def extract_doc(
    doc: ExamDoc,
    course_name: str,
    units: list[Unit],
    client: ChatClient,
    studio_dir: Path,
    *,
    force: bool = False,
) -> tuple[Extracted, int]:
    """The document's items; a rerun sends only the windows that failed."""
    unit_list = [(u.id, u.title) for u in units]
    windows = plan_extract(doc)
    payloads = [extract_payload(doc, w) for w in windows]
    full = digest(EXTRACT_VERSION, EXTRACT_SYSTEM, client.stage.model, unit_list, payloads)
    path = exams_dir(studio_dir) / "extract" / f"{doc.slug}.json"
    previous: Extracted | None = None
    if not force:
        try:
            previous = Extracted.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValidationError, ValueError):
            previous = None
    if previous is not None and previous.input_hash != full:
        previous = None
    if previous is not None and previous.complete:
        return previous, 0
    kept = {tuple(w.pages) for w in previous.windows if w.error is None} if previous else set()
    records: list[ExtractWindow] = []
    items: list[XItem] = []
    calls = 0
    for main, pages in zip(windows, payloads, strict=True):
        record = ExtractWindow(pages=main, error=None)
        if previous is not None and tuple(main) in kept:
            items += [i for i in previous.items if i.page in main]
        else:
            calls += 1
            try:
                batch = client.complete_json(
                    system=EXTRACT_SYSTEM,
                    user=extract_user(course_name, unit_list, doc.file, pages),
                    response_model=XBatch,
                    prompt_version=EXTRACT_VERSION,
                    subject=f"exam {doc.slug} pages {main[0]}-{main[-1]}",
                )
            except LLMError as exc:
                record.error = exc.code
            else:
                # Items that start on the context page belong to the next window.
                items += [i for i in batch.items if i.page in main]
        records.append(record)
    result = Extracted(
        version="studio-exam-extract-v1",
        file=doc.file,
        input_hash=full,
        windows=records,
        items=items,
    )
    write_json(path, result)
    return result, calls


# Grouping -----------------------------------------------------------------------------

ASKABLE = ("choice", "true_false", "short")


@dataclass
class Found:
    """One unique question and every place it was asked."""

    item: XItem
    keyed: bool  # it comes from a document whose bold marks the answers
    appearances: list[Appearance]
    flags: list[OriginFlag] = field(default_factory=list)
    # A unit whose slides match the question clearly better than the named one's.
    alternative: str | None = None

    @property
    def qid(self) -> str:
        return question_id(self.item.unit, self.item.stem)


def question_id(unit_id: str, stem: str) -> str:
    return f"{unit_id}-x{hashlib.sha256(fold(stem).encode()).hexdigest()[:6]}"


LEADING_NUMBER = re.compile(r"^\s*(?:\(\d{1,3}\.?\)|\d{1,3}[.)])\s+")
POINTS = re.compile(r"^\s*\(\s*\d+(?:[.,]\d+)?\s*bod\w*\s*\)\s*", re.IGNORECASE)
# Options the model copied into the stem as well: "...?\na) Generiranje ..."
INLINE_OPTIONS = re.compile(r"\s*\n\s*\(?a[.)]\s.*\Z", re.DOTALL)


def tidy(text: str, has_options: bool) -> str:
    text = POINTS.sub("", LEADING_NUMBER.sub("", text, count=1), count=1)
    return INLINE_OPTIONS.sub("", text) if has_options else text


def without_number(item: XItem) -> XItem:
    """The item without "10.", "(15.)", "(4 boda)" or copied options in its text."""
    has_options = bool(item.options)
    return item.model_copy(
        update={
            "stem": tidy(item.stem, has_options),
            "original": tidy(item.original, has_options),
        }
    )


def similar(a: str, b: str) -> bool:
    """Whether two folded texts say the same, allowing small spelling differences.

    Texts sharing few words are told apart cheaply first; the character comparison is
    slow and runs once for every pair of questions.
    """
    if a == b:
        return True
    words_a, words_b = set(a.split()), set(b.split())
    if not words_a or not words_b or len(words_a & words_b) < 0.34 * len(words_a | words_b):
        return False
    return min(partial_ratio(a, b), partial_ratio(b, a)) >= SAME_STEM


def same_option(text: str, others: list[str]) -> bool:
    """Whether an option says the same as one of the others ("podacima" / "podatcima")."""
    return any(similar(text, other) for other in others)


def keyed_document(items: list[XItem]) -> bool:
    """Whether bold marks the answers in this document, rather than headings."""
    choices = [i for i in items if i.kind == "choice" and len(i.options) >= 2]
    if not choices:
        return False
    marked = [i for i in choices if 0 < sum(o.marked for o in i.options) < len(i.options)]
    return len(marked) >= KEYED_SHARE * len(choices)


def same_question(a: XItem, b: XItem) -> bool:
    left_stem, right_stem = fold(a.stem), fold(b.stem)
    if not similar(left_stem, right_stem):
        return False
    if a.options and b.options:
        left = [fold(o.text) for o in a.options]
        right = [fold(o.text) for o in b.options]
        shared = sum(1 for text in left if same_option(text, right))
        return shared >= 0.5 * min(len(left), len(right))
    return True


def rank(f: Found) -> tuple[bool, bool, int]:
    """Prefer a version with options, then one with a marked key, then more options."""
    return bool(f.item.options), f.keyed, len(f.item.options)


def group(documents: list[tuple[Extracted, bool]], unit_ids: set[str]) -> list[Found]:
    found: list[Found] = []
    for doc, keyed in documents:
        for item in map(without_number, doc.items):
            if item.kind not in ASKABLE or (item.kind == "choice" and len(item.options) < 2):
                continue
            here = Appearance(file=doc.file, page=item.page, number=item.number)
            candidate = Found(item=item, keyed=keyed, appearances=[here])
            match = next((f for f in found if same_question(f.item, item)), None)
            if match is None:
                found.append(candidate)
            elif rank(candidate) > rank(match):
                candidate.appearances = [*match.appearances, here]
                found[found.index(match)] = candidate
            else:
                match.appearances.append(here)
    for f in found:
        if f.item.unit not in unit_ids:
            f.flags.append(OriginFlag(code="unit_uncertain", severity="warn", detail="no unit"))
    return found


# Matching slides ----------------------------------------------------------------------


def tokens(text: str) -> list[str]:
    return [t for t in fold(text).split() if len(t) >= 3]


@dataclass
class PageIndex:
    """BM25 over every unit's slide pages: which pages, and which unit, a question is about."""

    pages: list[tuple[str, PageText]]  # (unit id, page)
    terms: list[Counter[str]]
    idf: dict[str, float]
    average: float

    @classmethod
    def build(cls, units: list[Unit], docs: dict[str, PdfPages]) -> "PageIndex":
        pages = [(u.id, p) for u in units for p in unit_pages(u, docs, 10**9)]
        terms = [Counter(tokens(p.text)) for _, p in pages]
        df: Counter[str] = Counter()
        for t in terms:
            df.update(t.keys())
        n = max(1, len(pages))
        idf = {w: math.log(1 + (n - d + 0.5) / (d + 0.5)) for w, d in df.items()}
        average = sum(sum(t.values()) for t in terms) / n
        return cls(pages, terms, idf, average or 1.0)

    def scores(self, text: str) -> list[float]:
        query = set(tokens(text))
        out = []
        for t in self.terms:
            norm = 1.2 * (0.25 + 0.75 * sum(t.values()) / self.average)
            out.append(sum(self.idf[w] * t[w] * 2.2 / (t[w] + norm) for w in query & t.keys()))
        return out

    def best_pages(self, text: str, unit_id: str, k: int) -> list[PageText]:
        scored = [
            (s, i) for i, s in enumerate(self.scores(text)) if self.pages[i][0] == unit_id and s > 0
        ]
        return [self.pages[i][1] for _, i in sorted(scored, reverse=True)[:k]]

    def unit_of(self, pdf: str, page: int) -> str | None:
        return next((u for u, p in self.pages if p.pdf == pdf and p.page == page), None)

    def unit_scores(self, text: str) -> dict[str, float]:
        best: dict[str, float] = {}
        for (uid, _), s in zip(self.pages, self.scores(text), strict=True):
            best[uid] = max(best.get(uid, 0.0), s)
        return best


def question_text(item: XItem) -> str:
    return " ".join([item.stem, *(o.text for o in item.options)])


def unit_flag(f: Found, index: PageIndex, titles: dict[str, str]) -> None:
    """Flag a unit choice that the slides do not bear out."""
    scores = index.unit_scores(question_text(f.item))
    if f.item.unit not in scores:
        return
    top = max(scores, key=lambda u: scores[u])
    if top != f.item.unit and scores[f.item.unit] < 0.7 * scores[top]:
        detail = f"the slides of unit {top} ({titles.get(top, '')}) match it better"
        f.flags.append(OriginFlag(code="unit_uncertain", severity="warn", detail=detail))
        f.alternative = top


# Keys ---------------------------------------------------------------------------------


class KAnswer(Strict):
    id: str
    correct: list[int]
    truth: bool | None
    reference_answer: str | None
    explanation: str
    difficulty: int
    page: str
    quote: str
    problem: str | None


class KBatch(Strict):
    answers: list[KAnswer]


class KeyEntry(Strict):
    answer: KAnswer
    pdf: str | None
    page: int | None


class KeyStore(Strict):
    version: Literal["studio-exam-keys-v1"]
    entries: dict[str, KeyEntry]


def given_key(f: Found) -> list[int] | str | None:
    """The exam's own answer: marked option numbers, or a stated true/false or short answer."""
    if f.item.kind == "choice":
        marked = [n for n, o in enumerate(f.item.options, start=1) if o.marked]
        return marked if f.keyed and marked else None
    return f.item.answer


def key_question(f: Found) -> dict[str, object]:
    question: dict[str, object] = {"id": f.qid, "kind": f.item.kind, "stem": f.item.stem}
    if f.item.options:
        question["options"] = [
            {"number": n, "text": o.text} for n, o in enumerate(f.item.options, start=1)
        ]
    question["given_key"] = given_key(f)
    return question


@dataclass
class KeyRequest:
    found: list[Found] = field(default_factory=list)
    pages: list[PageText] = field(default_factory=list)
    hashes: dict[str, str] = field(default_factory=dict)  # question id -> cache key


def plan_keys(found: list[Found], index: PageIndex, size: int, model: str) -> list[KeyRequest]:
    """Requests per unit, at most `size` questions and about MAX_KEY_CHARS of pages each."""
    by_unit: dict[str, list[Found]] = {}
    for f in found:
        by_unit.setdefault(f.item.unit, []).append(f)
    requests: list[KeyRequest] = []
    for unit_id, items in by_unit.items():
        current = KeyRequest()
        for f in items:
            text = question_text(f.item)
            pages = index.best_pages(text, unit_id, PAGES_PER_QUESTION)
            if f.alternative:
                pages += index.best_pages(text, f.alternative, PAGES_PER_QUESTION - 1)
            merged = current.pages + [p for p in pages if p not in current.pages]
            too_big = sum(len(p.text) for p in merged) > MAX_KEY_CHARS
            if current.found and (len(current.found) >= size or too_big):
                requests.append(current)
                current, merged = KeyRequest(), list(pages)
            current.found.append(f)
            current.pages = merged
            # The cache key is the question and its own pages, not the whole request, so
            # regrouping requests never sends an answered question again.
            own = [[p.pdf, p.page, p.text] for p in pages]
            current.hashes[f.qid] = digest(KEY_VERSION, KEY_SYSTEM, model, key_question(f), own)
        if current.found:
            requests.append(current)
    return requests


def load_keys(studio_dir: Path) -> KeyStore:
    try:
        text = (exams_dir(studio_dir) / "keys.json").read_text(encoding="utf-8")
        return KeyStore.model_validate_json(text)
    except (OSError, ValidationError, ValueError):
        return KeyStore(version="studio-exam-keys-v1", entries={})


def ask_keys(request: KeyRequest, client: ChatClient) -> dict[str, KeyEntry]:
    labelled = [(f"P{i}", p) for i, p in enumerate(request.pages, start=1)]
    pages = dict(labelled)
    batch = client.complete_json(
        system=KEY_SYSTEM,
        user=key_user(
            [(label, p.text) for label, p in labelled], [key_question(f) for f in request.found]
        ),
        response_model=KBatch,
        prompt_version=KEY_VERSION,
        subject=f"exam keys unit {request.found[0].item.unit}",
    )
    out: dict[str, KeyEntry] = {}
    for answer in batch.answers:
        if answer.id in request.hashes:
            page = pages.get(answer.page.strip().upper())
            out[request.hashes[answer.id]] = KeyEntry(
                answer=answer, pdf=page.pdf if page else None, page=page.page if page else None
            )
    return out


# Building questions -------------------------------------------------------------------


def original_text(item: XItem) -> str:
    lines = [item.original.strip()]
    lines += [f"{LETTERS[i]}) {o.original.strip()}" for i, o in enumerate(item.options[:8])]
    if item.answer:
        lines.append(f"({item.answer})")
    return "\n".join(lines)


def truth_of(answer: str | None) -> bool | None:
    folded = fold(answer or "")
    if folded in ("t", "da", "true", "tocno", "istina", "istinito"):
        return True
    if folded in ("n", "f", "ne", "false", "netocno", "laz", "lazno"):
        return False
    return None


def build(f: Found, entry: KeyEntry | None) -> tuple[StoredQuestion | None, str | None]:
    """The stored question, or None and the reason it was left out."""
    item, answer = f.item, entry.answer if entry else None
    flags = list(f.flags)
    key: Literal["marked", "model"] = "model"
    content: dict[str, Any] = {"stem": item.stem.strip()}
    if item.kind == "choice":
        given = given_key(f)
        picked = answer.correct if answer else []
        chosen = sorted({n for n in picked if 1 <= n <= len(item.options)})
        if isinstance(given, list):
            key = "marked"
            if chosen and chosen != given:
                texts = ", ".join(item.options[n - 1].text[:60] for n in chosen)
                flags.append(
                    OriginFlag(
                        code="exam_key_disputed",
                        severity="warn",
                        detail=f"the slides point to: {texts}",
                    )
                )
            chosen = given
        if not chosen:
            return None, "no key: the slides do not decide it"
        content["type"] = "MULTIPLE_CHOICE" if len(chosen) == 1 else "MULTIPLE_SELECT"
        content["options"] = [
            {"text": o.text.strip(), "is_correct": n in chosen}
            for n, o in enumerate(item.options, start=1)
        ]
    elif item.kind == "true_false":
        stated = truth_of(item.answer)
        truth = stated if stated is not None else (answer.truth if answer else None)
        key = "marked" if stated is not None else "model"
        if truth is None:
            return None, "no key: the slides do not decide it"
        content["type"] = "TRUE_FALSE"
        content["correct_answer"] = truth
    else:
        reference = item.answer or (answer.reference_answer if answer else None)
        key = "marked" if item.answer else "model"
        if not reference:
            return None, "no reference answer"
        content["type"] = "SHORT_ANSWER"
        content["reference_answer"] = reference.strip()
    if answer is None:
        detail = "the key request failed; rerun studio exams"
        flags.append(OriginFlag(code="exam_unexplained", severity="warn", detail=detail))
    elif answer.problem:
        flags.append(OriginFlag(code="exam_key_problem", severity="warn", detail=answer.problem))
    content["explanation"] = (answer.explanation.strip() if answer else "") or None
    content["difficulty"] = min(5, max(1, answer.difficulty)) if answer else 3
    content = strip_content(content)
    quote = entry.answer.quote.strip() if entry else ""
    source = (
        Source(pdf=entry.pdf, page=entry.page, quote=quote)
        if entry and entry.pdf and entry.page and quote
        else None
    )
    origin = ExamOrigin(
        appearances=f.appearances, original=original_text(item), key=key, flags=flags
    )
    question = StoredQuestion(
        id=f.qid,
        window=0,
        content=content,
        source=source,
        schema_error=content_error(content),
        origin=origin,
    )
    return question, None


def merge(studio_dir: Path, unit: Unit, questions: list[StoredQuestion]) -> None:
    """Replace the unit's exam questions with these; generated questions stay as they are."""
    current = load_questions(studio_dir, unit.id)
    if current is None:
        if not questions:
            return
        current = UnitQuestions(
            version="studio-questions-v1",
            unit=unit.id,
            title=unit.title,
            prompt_version="",
            model="",
            input_hash="",
            generated_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            windows=[],
            questions=[],
        )
    generated = [q for q in current.questions if q.origin is None]
    ordered = generated + sorted(questions, key=lambda q: q.id)
    if ordered != current.questions:
        updated = current.model_copy(update={"questions": ordered})
        write_json(questions_path(studio_dir, unit.id), updated)


# The whole stage ----------------------------------------------------------------------


@dataclass
class ExamsResult:
    documents: list[tuple[ExamDoc, Extracted, bool]]
    added: dict[str, int]
    skipped: list[tuple[str, str]]  # (where, why)
    tasks: list[tuple[XItem, str]]  # (item, file)
    calls: int
    errors: list[str]


def run_exams(
    *,
    studio_dir: Path,
    course_name: str,
    course: CourseFile,
    docs: dict[str, PdfPages],
    exam_docs: list[ExamDoc],
    make_client: Callable[[], ChatClient],
    questions_per_call: int,
    workers: int = 1,
    force: bool = False,
) -> ExamsResult:
    units = course.units
    titles = {u.id: u.title for u in units}

    def extract(doc: ExamDoc) -> tuple[Extracted, int]:
        return extract_doc(doc, course_name, units, make_client(), studio_dir, force=force)

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        extracted = list(pool.map(extract, exam_docs))
    calls = sum(n for _, n in extracted)
    documents = [
        (doc, e, keyed_document(e.items)) for doc, (e, _) in zip(exam_docs, extracted, strict=True)
    ]
    errors = [
        f"{doc.file} pages {w.pages[0]}-{w.pages[-1]}: {w.error}"
        for doc, e, _ in documents
        for w in e.windows
        if w.error
    ]
    found = group([(e, keyed) for _, e, keyed in documents], set(titles))
    index = PageIndex.build(units, docs)
    for f in found:
        unit_flag(f, index, titles)

    # A question already in a unit whose transcription is unchanged stays exactly as it
    # is: its review decision and push record are tied to its content.
    previous = previous_questions(studio_dir, units)
    # A question the owner has decided on is frozen: it stays exactly as it is and
    # stands for every transcription of it, so neither its decision nor its push
    # record is ever lost. Only undecided questions are rebuilt or merged.
    decided = decided_ids(studio_dir, units)
    frozen = [q for q in previous.values() if q.id in decided]
    kept: dict[str, list[StoredQuestion]] = {}
    for f in found:
        if matches := [q for q in frozen if stored_match(f.item, q)]:
            kept[f.qid] = matches
        elif (
            (old := previous.get(f.qid)) is not None
            and old.origin is not None
            and old.origin.original == original_text(f.item)
        ):
            kept[f.qid] = [old]
    fresh = [f for f in found if f.qid not in kept and f.item.unit in titles]

    store = load_keys(studio_dir)
    model = make_client().stage.model
    requests = plan_keys(fresh, index, questions_per_call, model)
    hashes = {qid: h for r in requests for qid, h in r.hashes.items()}
    todo = [r for r in requests if any(h not in store.entries for h in r.hashes.values())]

    def ask(request: KeyRequest) -> tuple[dict[str, KeyEntry], str | None]:
        try:
            return ask_keys(request, make_client()), None
        except LLMError as exc:
            return {}, f"keys for unit {request.found[0].item.unit}: {exc.code}"

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for entries, error in pool.map(ask, todo):
            store.entries.update(entries)
            if error:
                errors.append(error)
    calls += len(todo)
    write_json(exams_dir(studio_dir) / "keys.json", store)

    by_unit: dict[str, list[StoredQuestion]] = {u.id: [] for u in units}
    new: dict[str, list[StoredQuestion]] = {u.id: [] for u in units}
    skipped: list[tuple[str, str]] = []
    placed: set[str] = set()
    for f in found:
        first = f.appearances[0]
        where = f"{first.file} #{first.number}"
        if f.qid in kept:
            for same in kept[f.qid]:
                if same.id not in placed:
                    placed.add(same.id)
                    by_unit[same.id.split("-x")[0]].append(same)
            continue
        if f.item.unit not in titles:
            skipped.append((where, "no unit"))
            continue
        entry = store.entries.get(hashes.get(f.qid, ""))
        if entry is None and f.qid in previous:
            # The key request failed: keep the question as it was rather than lose it.
            old = previous[f.qid]
            by_unit[old.id.split("-x")[0]].append(old)
            continue
        if entry is None:
            skipped.append((where, "the key request failed; rerun"))
            continue
        built, why = build(f, entry)
        if built is None:
            skipped.append((where, why or "left out"))
            continue
        unit_id = settle_unit(built, f.item.unit, index, titles)
        by_unit[unit_id].append(built)
        new[unit_id].append(built)
    produced = {q.id for qs in by_unit.values() for q in qs}
    for question in previous.values():
        # Decided questions always stay; after a failed request nothing is dropped.
        if question.id not in produced and (question.id in decided or errors):
            by_unit[question.id.split("-x")[0]].append(question)
    calls += reword(new, store, hashes, make_client)
    write_json(exams_dir(studio_dir) / "keys.json", store)
    for unit in units:
        merge(studio_dir, unit, by_unit[unit.id])
    added = {uid: len(qs) for uid, qs in by_unit.items() if qs}
    tasks = [(i, e.file) for _, e, _ in documents for i in e.items if i.kind == "task"]
    write_report(studio_dir, documents, added, skipped, tasks, titles)
    return ExamsResult(documents, added, skipped, tasks, calls, errors)


def decided_ids(studio_dir: Path, units: list[Unit]) -> set[str]:
    ids: set[str] = set()
    for unit in units:
        stored = load_questions(studio_dir, unit.id)
        if stored is not None:
            ids |= set(current_decisions(load_review(studio_dir, unit.id), stored))
    return ids


def stored_match(item: XItem, question: StoredQuestion) -> bool:
    """Whether a stored question asks what the transcribed item asks."""
    options = question.content.get("options") or []
    stem = fold(tidy(str(question.content.get("stem", "")), bool(options)))
    mine = fold(item.stem)
    if not similar(mine, stem):
        return False
    if item.options and options:
        theirs = [fold(str(o.get("text", ""))) for o in options]
        shared = sum(1 for o in item.options if same_option(fold(o.text), theirs))
        return shared >= 0.5 * min(len(item.options), len(theirs))
    return True


def previous_questions(studio_dir: Path, units: list[Unit]) -> dict[str, StoredQuestion]:
    """The units' current exam questions, by the id they had before any move."""
    found: dict[str, StoredQuestion] = {}
    for unit in units:
        stored = load_questions(studio_dir, unit.id)
        for question in stored.questions if stored else []:
            if question.origin is not None:
                found[question.origin.first_id or question.id] = question
    return found


def reword(
    by_unit: dict[str, list[StoredQuestion]],
    store: KeyStore,
    hashes: dict[str, str],
    make_client: Callable[[], ChatClient],
) -> int:
    """Rephrase text that still cites the slides, as generation does; returns requests sent.

    A rephrased explanation goes back into the key store, so a rerun does not send it again.
    """
    calls = 0
    for unit_id, questions in by_unit.items():
        if not any(references(q.content) for q in questions):
            continue
        fixed = rewrite(
            {q.id: q.content for q in questions}, make_client(), f"exams unit {unit_id}"
        )
        calls += fixed.calls
        for question in questions:
            content = fixed.contents[question.id]
            question.content = content
            question.schema_error = content_error(content)
            entry = store.entries.get(hashes.get(origin_id(question), ""))
            if entry is not None and content.get("explanation"):
                entry.answer.explanation = str(content["explanation"])
    return calls


def origin_id(question: StoredQuestion) -> str:
    """The id the question had before it moved to the unit of its slide."""
    return question.origin.first_id if question.origin and question.origin.first_id else question.id


def settle_unit(
    question: StoredQuestion, named: str, index: PageIndex, titles: dict[str, str]
) -> str:
    """The unit of the slide that supports the key, when there is one; else the named unit."""
    source = question.source
    unit = index.unit_of(source.pdf, source.page) if source else None
    if unit is None or question.origin is None:
        return named
    flags = [f for f in question.origin.flags if f.code != "unit_uncertain"]
    if unit != named:
        detail = f"named unit {named} ({titles.get(named, '')}); the quoted slide is in this one"
        flags.append(OriginFlag(code="exam_unit_moved", severity="info", detail=detail))
        question.origin.first_id = question.id
        question.id = question_id(unit, str(question.content["stem"]))
    question.origin.flags = flags
    return unit


def write_report(
    studio_dir: Path,
    documents: list[tuple[ExamDoc, Extracted, bool]],
    added: dict[str, int],
    skipped: list[tuple[str, str]],
    tasks: list[tuple[XItem, str]],
    titles: dict[str, str],
) -> None:
    report: dict[str, object] = {
        "documents": [
            {
                "file": doc.file,
                "pages": len(doc.pages),
                "ocr_pages": sum(p.ocr for p in doc.pages),
                "keyed": keyed,
                "items": dict(Counter(i.kind for i in e.items)),
            }
            for doc, e, keyed in documents
        ],
        "added": added,
        "skipped": [{"where": w, "why": y} for w, y in skipped],
    }
    write_json(exams_dir(studio_dir) / "report.json", report)
    lines = ["# Zadaci s ispita (nisu u bazi pitanja)", ""]
    for uid, title in titles.items():
        mine = [(i, f) for i, f in tasks if i.unit == uid]
        if mine:
            lines += [f"## {uid} {title}", ""]
            lines += [f"- {f}, zadatak {i.number}: {' '.join(i.original.split())}" for i, f in mine]
            lines.append("")
    (exams_dir(studio_dir) / "tasks.md").write_text("\n".join(lines), encoding="utf-8")
