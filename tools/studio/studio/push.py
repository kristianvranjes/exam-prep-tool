"""`studio push`: import accepted questions into the application through its own API.

Signs in as the course owner (the password is asked for or read from an environment
variable, and never stored), then per unit imports the accepted questions that have
not been pushed before, linked to the matching course unit, and with `--approve`
approves them in batches of 50. That last step works for an owner who is also a
faculty moderator, the rule the application already has; anyone else gets drafts.

`out/pushed-<course>.json` records every pushed question by a hash of its final
content, so pushing again after more questions were accepted sends only the new ones
and never duplicates the bank. The import uses the same `quiz-import-v2` document that
`studio publish` writes, validated with the application's schema before it is sent.
"""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError

from studio.appschema import import_error, question_module
from studio.checks import fold
from studio.config import App, StudioError
from studio.course import Unit
from studio.publish import Accepted, import_document, out_dir, unit_decisions
from studio.review import content_hash
from studio.store import write_json

APPROVE_BATCH = 50


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PushedQuestion(Strict):
    id: str
    content_hash: str
    app_id: str


class PushRecord(Strict):
    unit: str
    app_unit: str | None
    pushed_at: str
    questions: list[PushedQuestion]
    approved: int


class Ledger(Strict):
    version: Literal["studio-push-v1"]
    api_url: str
    course_id: str
    pushes: list[PushRecord]

    def pushed(self, unit_id: str) -> set[str]:
        return {q.content_hash for p in self.pushes if p.unit == unit_id for q in p.questions}


@dataclass(frozen=True)
class PushPlan:
    unit: Unit
    new: list[Accepted]
    already: int


@dataclass(frozen=True)
class PushResult:
    unit: Unit
    imported: int
    approved: int
    app_unit: str | None
    note: str | None = None


def ledger_path(studio_dir: Path, app: App) -> Path:
    return out_dir(studio_dir) / f"pushed-{app.course_id}.json"


def load_ledger(studio_dir: Path, app: App) -> Ledger:
    path = ledger_path(studio_dir, app)
    if not path.is_file():
        return Ledger(
            version="studio-push-v1", api_url=app.api_url, course_id=app.course_id, pushes=[]
        )
    try:
        return Ledger.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValidationError, ValueError):
        raise StudioError(f"{path} cannot be read; fix or move it before pushing again") from None


def plan(studio_dir: Path, app: App, units: list[Unit]) -> list[PushPlan]:
    ledger = load_ledger(studio_dir, app)
    plans = []
    for unit in units:
        decisions = unit_decisions(studio_dir, unit.id)
        if decisions is None:
            continue
        done = ledger.pushed(unit.id)
        new = [a for a in decisions.accepted if content_hash(a.content) not in done]
        plans.append(PushPlan(unit, new, len(decisions.accepted) - len(new)))
    return plans


class AppClient:
    """A signed-in session against the ExamPrep API."""

    def __init__(self, app: App, transport: httpx.BaseTransport | None = None) -> None:
        self.app = app
        self.client = httpx.Client(
            base_url=app.api_url,
            transport=transport,
            timeout=60,
            trust_env=False,
            follow_redirects=False,
            headers={"Origin": app.origin, "User-Agent": "examprep-studio"},
        )

    def close(self) -> None:
        self.client.close()

    def _check(self, response: httpx.Response, what: str) -> Any:
        if response.is_success:
            return response.json() if response.content else None
        try:
            detail = response.json().get("detail")
        except (ValueError, AttributeError):
            detail = None
        text = detail if isinstance(detail, str) else response.reason_phrase
        raise StudioError(f"{what} failed: HTTP {response.status_code} {text}")

    def _send(self, method: str, path: str, what: str, **kwargs: Any) -> Any:
        try:
            response = self.client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise StudioError(f"{what} failed: {type(exc).__name__}") from None
        return self._check(response, what)

    def login(self, password: str) -> None:
        self._send(
            "POST", "/auth/login", "sign-in", json={"email": self.app.email, "password": password}
        )

    def units(self) -> list[dict[str, Any]]:
        found = self._send("GET", f"/courses/{self.app.course_id}/units", "listing course units")
        return list(found or [])

    def import_questions(self, document: dict[str, object], unit_id: str | None) -> list[Any]:
        result = self._send(
            "POST",
            f"/courses/{self.app.course_id}/questions/import",
            "import",
            params={"unit_ids": [unit_id]} if unit_id else None,
            content=json.dumps(document, ensure_ascii=False).encode(),
            headers={"Content-Type": "application/json"},
        )
        return list(result or [])

    def approve(self, question_ids: list[str]) -> int:
        changed = 0
        for start in range(0, len(question_ids), APPROVE_BATCH):
            result = self._send(
                "POST",
                f"/courses/{self.app.course_id}/questions/transition",
                "approval",
                json={
                    "question_ids": question_ids[start : start + APPROVE_BATCH],
                    "action": "approve",
                },
            )
            changed += int(result.get("changed", 0)) if isinstance(result, dict) else 0
        return changed


def match_unit(unit: Unit, app_units: list[dict[str, Any]]) -> str:
    """The application unit for a studio unit: `app_unit` in course.yaml, or a unique title."""
    active = [u for u in app_units if not u.get("is_archived")]
    listing = "; ".join(f"{u['id']} {u.get('title', '')}" for u in active) or "none"
    if unit.app_unit:
        if any(str(u["id"]).lower() == unit.app_unit.lower() for u in active):
            return unit.app_unit
        raise StudioError(
            f"unit {unit.id}: app_unit {unit.app_unit} is not an active unit ({listing})"
        )
    same = [u for u in active if fold(str(u.get("title", ""))) == fold(unit.title)]
    if len(same) == 1:
        return str(same[0]["id"])
    raise StudioError(
        f"unit {unit.id} ({unit.title}): no single application unit with this title; "
        f"set app_unit in course.yaml to one of: {listing}"
    )


def map_imported(sent: list[Accepted], imported: list[Any]) -> list[PushedQuestion]:
    """Pair imported questions with what was sent by stem (stems are unique per import)."""
    normalize = question_module().normalize
    ids = {
        normalize(str(q.get("stem", ""))): str(q.get("id")) for q in imported if isinstance(q, dict)
    }
    pushed = []
    for question in sent:
        app_id = ids.get(normalize(str(question.content["stem"])))
        if app_id:
            pushed.append(
                PushedQuestion(
                    id=question.id, content_hash=content_hash(question.content), app_id=app_id
                )
            )
    return pushed


def push(
    studio_dir: Path,
    app: App,
    units: list[Unit],
    password: str,
    *,
    approve: bool,
    transport: httpx.BaseTransport | None = None,
) -> list[PushResult]:
    plans = [p for p in plan(studio_dir, app, units) if p.new]
    for p in plans:
        if error := import_error(import_document(p.new)):
            raise StudioError(f"unit {p.unit.id}: {error}; run `studio publish` to see the file")
    if not plans:
        return []

    ledger = load_ledger(studio_dir, app)
    results = []
    client = AppClient(app, transport)
    try:
        client.login(password)
        app_units = client.units()
        targets = {p.unit.id: match_unit(p.unit, app_units) for p in plans}
        for p in plans:
            imported = client.import_questions(import_document(p.new), targets[p.unit.id])
            pushed = map_imported(p.new, imported)
            record = PushRecord(
                unit=p.unit.id,
                app_unit=targets[p.unit.id],
                pushed_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                questions=pushed,
                approved=0,
            )
            ledger.pushes.append(record)
            # Recorded before approval, so a failed approval never leads to a second import.
            write_json(ledger_path(studio_dir, app), ledger)
            note = None
            if len(pushed) != len(p.new):
                note = f"{len(p.new) - len(pushed)} imported questions could not be matched by stem"
            if approve and pushed:
                try:
                    record.approved = client.approve([q.app_id for q in pushed])
                except StudioError as exc:
                    note = f"imported as drafts; {exc}"
                write_json(ledger_path(studio_dir, app), ledger)
            results.append(
                PushResult(p.unit, len(pushed), record.approved, targets[p.unit.id], note)
            )
    finally:
        client.close()
    return results
