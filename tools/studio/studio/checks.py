"""Stage 4, checks: deterministic flags on generated questions. Nothing is fixed silently.

Per question: the application's import schema, a cited page that was actually shown,
the quote found on that page (fuzzy, so OCR damage and diacritics do not break it),
duplicate stems across the course and against the existing bank, and option heuristics.
Per unit: failed or uncovered windows, the blueprint, true/false balance, the position
of the correct option and the difficulty spread. When `studio verify` has run on the
current questions, its disagreements, unanswerable questions and named problems are
added as review flags.

Severities: `error` means the question cannot be imported as it is; `warn` needs a
careful look in review; `info` is a hint.
"""

import hashlib
import json
import re
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from studio.config import StudioConfig, StudioError, TypeCounts
from studio.course import CourseFile
from studio.generate import (
    OPTION_TYPES,
    StoredQuestion,
    UnitQuestions,
    load_questions,
    questions_path,
    unit_counts,
)
from studio.ingest import PdfPages
from studio.sources import fold, references
from studio.store import unit_dir, write_json
from studio.verify import Verdict, fresh_verify, key_letters

CHECKS_FILE = "checks.json"
Severity = Literal["error", "warn", "info"]

GROUNDED = 0.9
WEAK = 0.75
MIN_QUOTE_CHARS = 12
NEAR_DUPLICATE = 0.85
# Matched against folded text (no diacritics, lower case).
ALL_OR_NONE = re.compile(
    r"\b(?:sv[eia]\w*\s+(?:od\s+)?navede\w*|nista\s+od\s+navede\w*|nijedn\w*\s+od\s+navede\w*"
    r"|(?:all|none)\s+of\s+the\s+above)\b"
)
NEGATED = re.compile(r"\b(?:nije|nisu|ne|osim|netocn\w*|pogresn\w*|not|except|incorrect)\b")
# Options are reordered after generation, so "opcija B" in an explanation may point at
# the wrong option. Matched against folded text.
OPTION_LETTER = re.compile(
    r"\b(?:opcij\w*|odgovor\w*|ponud\w*|option|answer)\s+\(?[a-f]\)?(?=\W|$)"
    r"|\b(?:prv|drug|trec|cetvrt|zadnj)\w*\s+(?:opcij\w*|odgovor\w*|ponud\w*)"
)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Flag(Strict):
    code: str
    severity: Severity
    detail: str


class QuestionChecks(Strict):
    id: str
    flags: list[Flag]


class UnitChecks(Strict):
    version: Literal["studio-checks-v1"]
    unit: str
    questions_hash: str
    questions: list[QuestionChecks]
    unit_flags: list[Flag]
    summary: dict[str, int]


def partial_ratio(needle: str, hay: str) -> float:
    """Similarity of needle to its best-matching stretch of hay, from 0 to 1."""
    if not needle or not hay:
        return 0.0
    if needle in hay:
        return 1.0
    if len(needle) >= len(hay):
        return SequenceMatcher(None, needle, hay, autojunk=False).ratio()
    best = 0.0
    matcher = SequenceMatcher(None, needle, hay, autojunk=False)
    for a, b, size in matcher.get_matching_blocks():
        if not size:
            continue
        start = max(0, b - a)
        stretch = hay[start : start + len(needle)]
        best = max(best, SequenceMatcher(None, needle, stretch, autojunk=False).ratio())
    return best


def tokens(folded: str) -> frozenset[str]:
    return frozenset(w for w in folded.split() if len(w) > 2)


def jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    return len(a & b) / len(a | b) if a or b else 0.0


def flag(code: str, severity: Severity, detail: str = "") -> Flag:
    return Flag(code=code, severity=severity, detail=detail)


def grounding(question: StoredQuestion, docs: dict[str, PdfPages]) -> list[Flag]:
    source = question.source
    if source is None:
        return [flag("no_source", "error", "cites a source label that was not in its window")]
    doc = docs.get(source.pdf)
    if doc is None or not 1 <= source.page <= doc.page_count:
        return [flag("no_source", "error", f"{source.pdf} p. {source.page} is not ingested")]
    page = doc.pages[source.page - 1]
    # A quote stitched from bullets with "..." is checked piece by piece.
    pieces = [fold(p) for p in re.split(r"\.\.\.|…", source.quote)]
    pieces = [p for p in pieces if p]
    if sum(len(p) for p in pieces) < MIN_QUOTE_CHARS:
        return [flag("quote_short", "warn", "the quote is too short to show grounding")]
    text = fold(page.text)
    score = min(partial_ratio(p, text) for p in ([p for p in pieces if len(p) >= 4] or pieces))
    where = f"p. {source.page}" + (" (OCR-damaged page)" if "ocr_noise" in page.flags else "")
    if score >= GROUNDED:
        return []
    if score >= WEAK:
        return [flag("quote_weak", "info", f"quote matches {where} only partly ({score:.2f})")]
    return [flag("quote_not_found", "warn", f"quote not found on {where} ({score:.2f})")]


def correct_is_longest(options: list[dict[str, Any]]) -> bool:
    lengths = sorted(
        ((len(str(o.get("text", ""))), bool(o.get("is_correct"))) for o in options), reverse=True
    )
    return len(lengths) > 1 and lengths[0][1] and lengths[0][0] >= 1.25 * lengths[1][0]


def correct_position(content: dict[str, Any]) -> int | None:
    marked = [i for i, o in enumerate(content.get("options") or []) if o.get("is_correct")]
    return marked[0] if len(marked) == 1 else None


def option_flags(content: dict[str, Any]) -> list[Flag]:
    options = content.get("options") or []
    if content.get("type") not in OPTION_TYPES or not options:
        return []
    flags = []
    texts = [fold(str(o.get("text", ""))) for o in options]
    if any(ALL_OR_NONE.search(t) for t in texts):
        flags.append(flag("all_or_none_option", "warn", "an option is 'all/none of the above'"))
    for i in range(len(texts)):
        for j in range(i + 1, len(texts)):
            if SequenceMatcher(None, texts[i], texts[j], autojunk=False).ratio() >= 0.9:
                flags.append(flag("options_too_similar", "warn", f"options {i + 1} and {j + 1}"))
    if NEGATED.search(fold(str(content.get("stem", "")))):
        flags.append(flag("negated_stem", "info", "the stem asks for what is not true"))
    if content["type"] == "MULTIPLE_CHOICE" and correct_is_longest(options):
        flags.append(flag("correct_option_longest", "info", "the key is clearly the longest"))
    return flags


def key_text(content: dict[str, Any]) -> str:
    kind = content["type"]
    if kind in OPTION_TYPES:
        return ", ".join(key_letters(content))
    if kind == "TRUE_FALSE":
        return "true" if content["correct_answer"] else "false"
    if kind == "NUMERIC":
        return str(content["correct_value"])
    return "the reference answer"


def answer_text(question: StoredQuestion, verdict: Verdict) -> str:
    kind = question.content["type"]
    if kind in OPTION_TYPES:
        return ", ".join(verdict.choice) or "nothing"
    if kind == "TRUE_FALSE":
        return "nothing" if verdict.truth is None else str(verdict.truth).lower()
    if kind == "NUMERIC":
        return verdict.value or "nothing"
    return "not supported" if verdict.reference_supported is False else "nothing"


def verifier_flags(question: StoredQuestion, verdict: Verdict) -> list[Flag]:
    flags = []
    if verdict.agrees is False:
        detail = (
            f"verifier: {answer_text(question, verdict)}, key: {key_text(question.content)} "
            f"({verdict.confidence}). {verdict.reason}"
        )
        flags.append(flag("verifier_disagrees", "warn", detail))
    elif verdict.agrees is None:
        flags.append(flag("verifier_unanswerable", "warn", f"not answerable: {verdict.reason}"))
    elif verdict.confidence == "low":
        flags.append(flag("verifier_unsure", "info", verdict.reason))
    if verdict.problem:
        flags.append(flag("verifier_problem", "warn", verdict.problem))
    return flags


def glob_files(studio_dir: Path, pattern: str) -> list[Path]:
    candidate = Path(pattern)
    if candidate.is_absolute():
        return sorted(candidate.parent.glob(candidate.name))
    return sorted(studio_dir.glob(pattern))


def load_bank(studio_dir: Path, config: StudioConfig) -> list[tuple[str, str]]:
    """(label, folded stem) for every question in the configured bank files."""
    bank = []
    for pattern in config.checks.existing:
        paths = [p for p in glob_files(studio_dir, pattern) if p.is_file()]
        if not paths:
            raise StudioError(f"[checks] existing pattern {pattern!r} matches no files")
        for path in paths:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                stems = [str(q["stem"]) for q in data["questions"]]
            except (OSError, ValueError, KeyError, TypeError):
                raise StudioError(f"{path} is not a quiz import file") from None
            bank += [(f"{path.name} #{i}", fold(s)) for i, s in enumerate(stems, start=1)]
    return bank


def duplicate_flags(
    units: list[UnitQuestions], bank: list[tuple[str, str]]
) -> dict[str, list[Flag]]:
    """Each question against the bank and against earlier questions of the course."""
    seen = [(label, stem, tokens(stem)) for label, stem in bank]
    flags: dict[str, list[Flag]] = {}
    for unit in units:
        for question in unit.questions:
            stem = fold(str(question.content.get("stem", "")))
            mine = tokens(stem)
            found = []
            for label, other, other_tokens in seen:
                if stem == other:
                    found.append(flag("duplicate", "warn", f"same stem as {label}"))
                elif jaccard(mine, other_tokens) >= 0.5:
                    ratio = SequenceMatcher(None, stem, other, autojunk=False).ratio()
                    if ratio >= NEAR_DUPLICATE:
                        found.append(flag("near_duplicate", "warn", f"{ratio:.2f} like {label}"))
                if len(found) >= 3:
                    break
            flags[question.id] = found
            seen.append((question.id, stem, mine))
    return flags


def window_flags(unit: UnitQuestions) -> list[Flag]:
    flags = []
    for window in unit.windows:
        pages = f"{window.pages[0]} to {window.pages[-1]}" if window.pages else "no pages"
        where = f"window {window.index} ({pages})"
        if window.error:
            flags.append(flag("window_failed", "error", f"{where}: {window.error}"))
        elif sum(window.requested.values()) and not window.received:
            flags.append(flag("window_uncovered", "warn", where))
    return flags


def balance_flags(counts: TypeCounts, valid: list[StoredQuestion]) -> list[Flag]:
    flags = []
    made = Counter(q.content["type"] for q in valid)
    for kind, wanted in sorted(counts.items()):
        if made[kind] < wanted:
            flags.append(flag("blueprint_short", "warn", f"{kind} {made[kind]}/{wanted}"))
        elif made[kind] > wanted:
            flags.append(flag("blueprint_over", "info", f"{kind} {made[kind]}/{wanted}"))

    answers = [q.content["correct_answer"] for q in valid if q.content["type"] == "TRUE_FALSE"]
    if len(answers) >= 4 and not 0.3 <= sum(answers) / len(answers) <= 0.7:
        flags.append(flag("true_false_balance", "warn", f"{sum(answers)} of {len(answers)} true"))

    choice = [q.content for q in valid if q.content["type"] == "MULTIPLE_CHOICE"]
    positions = Counter(p for c in choice if (p := correct_position(c)) is not None)
    if len(choice) >= 6 and positions:
        place, n = positions.most_common(1)[0]
        if n > 0.5 * len(choice):
            detail = f"the key is option {place + 1} in {n} of {len(choice)}"
            flags.append(flag("answer_position", "warn", detail))
    longest = sum(correct_is_longest(c["options"]) for c in choice)
    if len(choice) >= 6 and longest >= 0.4 * len(choice):
        flags.append(flag("correct_longest_often", "warn", f"{longest} of {len(choice)}"))

    levels = {d for q in valid if (d := q.content.get("difficulty")) is not None}
    if len(valid) >= 6 and len(levels) == 1:
        flags.append(flag("difficulty_flat", "warn", f"all at difficulty {levels.pop()}"))
    return flags


def check_course(
    config: StudioConfig, course: CourseFile, docs: dict[str, PdfPages], studio_dir: Path
) -> list[UnitChecks]:
    specs = {u.id: u for u in course.units}
    units = [q for u in course.units if (q := load_questions(studio_dir, u.id)) is not None]
    duplicates = duplicate_flags(units, load_bank(studio_dir, config))
    results = []
    for unit in units:
        verify = fresh_verify(studio_dir, unit.unit)
        verdicts = {v.id: v for v in verify.verdicts} if verify else {}
        questions = []
        for question in unit.questions:
            flags = []
            if question.id in verdicts:
                flags += verifier_flags(question, verdicts[question.id])
            if question.schema_error:
                flags.append(flag("invalid_schema", "error", question.schema_error))
            flags += grounding(question, docs)
            flags += duplicates.get(question.id, [])
            flags += option_flags(question.content)
            if cites := references(question.content):
                where = ", ".join(f'{name} ("{text}")' for name, text in cites.items())
                detail = (
                    f"mentions the source, slides or lecture, which students never see: {where}"
                )
                flags.append(flag("refers_to_source", "error", detail + "; run studio rewrite"))
            explanation = fold(str(question.content.get("explanation") or ""))
            if question.content["type"] in OPTION_TYPES and OPTION_LETTER.search(explanation):
                detail = (
                    "the explanation names an option by letter or position; options are shuffled"
                )
                flags.append(flag("explanation_names_option_letter", "warn", detail))
            if not question.content.get("explanation"):
                flags.append(flag("no_explanation", "info", "no explanation for the answer"))
            questions.append(QuestionChecks(id=question.id, flags=flags))

        spec = specs[unit.unit]
        valid = [q for q in unit.questions if not q.schema_error]
        text_page_count = len({p for w in unit.windows for p in w.pages})
        counts = unit_counts(spec, config.questions, text_page_count)
        own = window_flags(unit) + balance_flags(counts, valid)
        if verify is not None:
            own += [
                flag("verify_failed", "warn", f"batch {b.index}: {b.error}; rerun verify")
                for b in verify.batches
                if b.error
            ]
        severities = Counter(f.severity for q in questions for f in q.flags)
        severities.update(f.severity for f in own)
        text_pages = {p for w in unit.windows for p in w.pages}
        cited = {f"{q.source.pdf}:{q.source.page}" for q in unit.questions if q.source}
        path = questions_path(studio_dir, unit.unit)
        result = UnitChecks(
            version="studio-checks-v1",
            unit=unit.unit,
            questions_hash=hashlib.sha256(path.read_bytes()).hexdigest(),
            questions=questions,
            unit_flags=own,
            summary={
                "questions": len(unit.questions),
                "error": severities["error"],
                "warn": severities["warn"],
                "info": severities["info"],
                "pages": len(text_pages),
                "cited_pages": len(cited & text_pages),
                "verified": len(verdicts),
                "verifier_agrees": sum(v.agrees is True for v in verdicts.values()),
            },
        )
        write_json(unit_dir(studio_dir, unit.unit) / CHECKS_FILE, result)
        results.append(result)
    return results


def load_checks(studio_dir: Path, unit_id: str) -> UnitChecks | None:
    path = unit_dir(studio_dir, unit_id) / CHECKS_FILE
    try:
        return UnitChecks.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
