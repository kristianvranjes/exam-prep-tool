"""Stage 7, publish: the owner's accepted questions as the application's import files.

One `quiz-import-v2` file per unit in `out/`, holding only accepted questions (edited
ones in their edited form), validated as a whole with the application's own
`QuizImport`. The format has no room for provenance, so `out/manifest.json` records,
per question, the studio id, the decision and the cited PDF page.

Files in `out/` are generated: publishing a unit replaces its earlier file, and a unit
with nothing accepted has no file.
"""

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from studio.appschema import IMPORT_VERSION, import_error
from studio.config import StudioError
from studio.course import CourseFile, Unit
from studio.generate import load_questions
from studio.ingest import slugify
from studio.review import current_decisions, load_review
from studio.store import write_json

OUT_DIR = "out"
MANIFEST = "manifest.json"
SUFFIX = ".quiz-import-v2.json"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Provenance(Strict):
    id: str
    decision: Literal["accept", "edit"]
    pdf: str | None
    page: int | None


class PublishedUnit(Strict):
    unit: str
    title: str
    file: str | None
    sha256: str | None
    questions: int
    rejected: int
    undecided: int
    provenance: list[Provenance]


class Manifest(Strict):
    version: Literal["studio-publish-v1"]
    course: str
    published_at: str
    units: list[PublishedUnit]


@dataclass(frozen=True)
class Accepted:
    id: str
    decision: Literal["accept", "edit"]
    content: dict[str, Any]
    pdf: str | None
    page: int | None


@dataclass(frozen=True)
class UnitDecisions:
    accepted: list[Accepted]
    rejected: int
    undecided: int


def clean(content: dict[str, Any]) -> dict[str, Any]:
    """The import shape without empty optional fields."""
    return {key: value for key, value in content.items() if value is not None}


def unit_decisions(studio_dir: Path, unit_id: str) -> UnitDecisions | None:
    questions = load_questions(studio_dir, unit_id)
    if questions is None:
        return None
    decisions = current_decisions(load_review(studio_dir, unit_id), questions)
    accepted: list[Accepted] = []
    rejected = undecided = 0
    for question in sorted(questions.questions, key=lambda q: q.id):
        decided = decisions.get(question.id)
        if decided is None:
            undecided += 1
        elif decided.decision == "reject":
            rejected += 1
        else:
            content = decided.content if decided.decision == "edit" else question.content
            source = question.source
            accepted.append(
                Accepted(
                    id=question.id,
                    decision=decided.decision,
                    content=clean(content or {}),
                    pdf=source.pdf if source else None,
                    page=source.page if source else None,
                )
            )
    return UnitDecisions(accepted, rejected, undecided)


def import_document(questions: list[Accepted]) -> dict[str, object]:
    return {"version": IMPORT_VERSION, "questions": [q.content for q in questions]}


def unit_file(unit: Unit) -> str:
    return f"{unit.id}-{slugify(unit.title)}{SUFFIX}"


def out_dir(studio_dir: Path) -> Path:
    return studio_dir / OUT_DIR


def load_manifest(studio_dir: Path) -> Manifest | None:
    try:
        text = (out_dir(studio_dir) / MANIFEST).read_text(encoding="utf-8")
        return Manifest.model_validate_json(text)
    except (OSError, ValidationError, ValueError):
        return None


def publish(studio_dir: Path, course: CourseFile, units: list[Unit]) -> Manifest:
    """Write import files for the given units; nothing is written if any unit is invalid."""
    planned: list[tuple[Unit, UnitDecisions]] = []
    problems = []
    for unit in units:
        decisions = unit_decisions(studio_dir, unit.id)
        if decisions is None:
            continue
        if decisions.accepted:
            error = import_error(import_document(decisions.accepted))
            if error:
                problems.append(f"unit {unit.id}: {error}")
        planned.append((unit, decisions))
    if problems:
        raise StudioError("not published, fix these in review first: " + "; ".join(problems))
    if not planned:
        raise StudioError("no generated questions in the selected units")

    target = out_dir(studio_dir)
    target.mkdir(parents=True, exist_ok=True)
    entries = {}
    for unit, decisions in planned:
        for stale in target.glob(f"{unit.id}-*{SUFFIX}"):
            stale.unlink()
        name = sha = None
        if decisions.accepted:
            name = unit_file(unit)
            payload = json.dumps(import_document(decisions.accepted), ensure_ascii=False, indent=1)
            (target / name).write_text(payload, encoding="utf-8")
            sha = hashlib.sha256(payload.encode()).hexdigest()
        entries[unit.id] = PublishedUnit(
            unit=unit.id,
            title=unit.title,
            file=name,
            sha256=sha,
            questions=len(decisions.accepted),
            rejected=decisions.rejected,
            undecided=decisions.undecided,
            provenance=[
                Provenance(id=a.id, decision=a.decision, pdf=a.pdf, page=a.page)
                for a in decisions.accepted
            ],
        )

    previous = load_manifest(studio_dir)
    if previous is not None:
        for entry in previous.units:
            entries.setdefault(entry.unit, entry)
    manifest = Manifest(
        version="studio-publish-v1",
        course=course.course.name,
        published_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        units=[entries[u.id] for u in course.units if u.id in entries],
    )
    write_json(target / MANIFEST, manifest)
    return manifest
