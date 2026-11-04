"""Stage 6, review: a local page where the course owner accepts, edits or rejects questions.

`studio review` serves one page on 127.0.0.1. Each question is shown with its key, the
cited page with the quote marked, the checks' flags and the verifier's answer; flagged
questions come first. Decisions are written to `build/units/<id>/review.json` and are
tied to a hash of the question's generated content, so a regenerated question never
inherits a decision made about different text. An edit is validated with the
application's import schema before it is stored.

Unflagged questions are sampled: once enough of them have been reviewed (a fifth, at
least three) with none rejected, the rest can be accepted together. A rejection in the
sample means the checks miss something in this unit, so each question needs a look.

The server binds to 127.0.0.1 only, requires a random token on every API call and
checks the Host header, so other pages open in the browser cannot read or post.
"""

import hashlib
import json
import math
import secrets
import threading
from datetime import UTC, datetime
from difflib import SequenceMatcher
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from studio.appschema import content_error
from studio.checks import load_checks
from studio.config import StudioError
from studio.course import CourseFile, Unit
from studio.generate import StoredQuestion, UnitQuestions, load_questions, questions_path
from studio.ingest import PdfPages
from studio.store import unit_dir, write_json
from studio.verify import fresh_verify

REVIEW_FILE = "review.json"
Decision = Literal["accept", "edit", "reject"]
SAMPLE_SHARE = 0.2
SAMPLE_MIN = 3
MAX_BODY = 1 << 20
SEVERITY_RANK = {"error": 0, "warn": 1, "info": 2}
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
}
POLICY = (
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
    "img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)
_lock = threading.Lock()


class ReviewError(StudioError):
    def __init__(self, status: HTTPStatus, message: str) -> None:
        self.status = status
        super().__init__(message)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Decided(Strict):
    decision: Decision
    content_hash: str
    content: dict[str, Any] | None = None
    note: str | None = None
    bulk: bool = False
    decided_at: str


class UnitReview(Strict):
    version: Literal["studio-review-v1"]
    unit: str
    decisions: dict[str, Decided]


def content_hash(content: dict[str, Any]) -> str:
    encoded = json.dumps(content, sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def review_path(studio_dir: Path, unit_id: str) -> Path:
    return unit_dir(studio_dir, unit_id) / REVIEW_FILE


def load_review(studio_dir: Path, unit_id: str) -> UnitReview:
    """The unit's decisions. A damaged file stops the studio rather than being replaced."""
    path = review_path(studio_dir, unit_id)
    if not path.is_file():
        return UnitReview(version="studio-review-v1", unit=unit_id, decisions={})
    try:
        return UnitReview.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValidationError, ValueError):
        raise StudioError(f"{path} cannot be read; fix or move it, decisions are kept") from None


def current_decisions(review: UnitReview, questions: UnitQuestions) -> dict[str, Decided]:
    """Decisions that still describe the question with that id."""
    hashes = {q.id: content_hash(q.content) for q in questions.questions}
    return {qid: d for qid, d in review.decisions.items() if hashes.get(qid) == d.content_hash}


def now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def highlight(text: str, quote: str) -> list[int] | None:
    """Approximate [start, end) of the quote in the page text, for marking it."""
    hay, needle = text.lower(), quote.lower()
    if len(hay) != len(text) or len(needle) < 12:
        return None
    match = SequenceMatcher(None, hay, needle, autojunk=False).find_longest_match(
        0, len(hay), 0, len(needle)
    )
    if match.size < 12:
        return None
    start = max(0, match.a - match.b)
    return [start, min(len(text), start + len(quote))]


def flagged(flags: list[dict[str, str]]) -> bool:
    return any(f["severity"] in ("error", "warn") for f in flags)


def sample_needed(unflagged: int) -> int:
    return min(unflagged, max(SAMPLE_MIN, math.ceil(SAMPLE_SHARE * unflagged)))


def checks_fresh(studio_dir: Path, unit_id: str) -> dict[str, list[dict[str, str]]] | None:
    checks = load_checks(studio_dir, unit_id)
    digest = hashlib.sha256(questions_path(studio_dir, unit_id).read_bytes()).hexdigest()
    if checks is None or checks.questions_hash != digest:
        return None
    return {q.id: [f.model_dump() for f in q.flags] for q in checks.questions}


def item(
    question: StoredQuestion,
    flags: list[dict[str, str]],
    docs: dict[str, PdfPages],
    verdict: dict[str, Any] | None,
    decision: Decided | None,
) -> dict[str, Any]:
    source = None
    if question.source is not None and question.source.pdf in docs:
        doc = docs[question.source.pdf]
        if 1 <= question.source.page <= doc.page_count:
            text = doc.pages[question.source.page - 1].text
            source = {
                "pdf": doc.source,
                "page": question.source.page,
                "quote": question.source.quote,
                "text": text,
                "highlight": highlight(text, question.source.quote),
            }
    rank = min((SEVERITY_RANK[f["severity"]] for f in flags), default=3)
    return {
        "id": question.id,
        "content": question.content,
        "schema_error": question.schema_error,
        "flags": sorted(flags, key=lambda f: SEVERITY_RANK[f["severity"]]),
        "rank": rank,
        "flagged": flagged(flags),
        "source": source,
        "verdict": verdict,
        "decision": decision.model_dump() if decision else None,
    }


def stats(items: list[dict[str, Any]]) -> dict[str, Any]:
    decided = [i for i in items if i["decision"]]
    unflagged = [i for i in items if not i["flagged"]]
    sampled = [i for i in unflagged if i["decision"] and not i["decision"]["bulk"]]
    needed = sample_needed(len(unflagged))
    rejected_in_sample = sum(i["decision"]["decision"] == "reject" for i in sampled)
    remaining = sum(1 for i in unflagged if not i["decision"] and not i["schema_error"])
    return {
        "total": len(items),
        "flagged": len(items) - len(unflagged),
        "flagged_reviewed": sum(1 for i in items if i["flagged"] and i["decision"]),
        "unflagged": len(unflagged),
        "unflagged_reviewed": len(sampled),
        "sample_needed": needed,
        "rejected_in_sample": rejected_in_sample,
        "remaining_unflagged": remaining,
        "bulk_allowed": remaining > 0 and len(sampled) >= needed and not rejected_in_sample,
        "accepted": sum(d["decision"]["decision"] == "accept" for d in decided),
        "edited": sum(d["decision"]["decision"] == "edit" for d in decided),
        "rejected": sum(d["decision"]["decision"] == "reject" for d in decided),
        "undecided": len(items) - len(decided),
    }


def unit_view(studio_dir: Path, unit: Unit, docs: dict[str, PdfPages]) -> dict[str, Any]:
    questions = load_questions(studio_dir, unit.id)
    if questions is None:
        return {"id": unit.id, "title": unit.title, "generated": False, "items": []}
    flags = checks_fresh(studio_dir, unit.id)
    verify = fresh_verify(studio_dir, unit.id)
    verdicts = {v.id: v.model_dump() for v in verify.verdicts} if verify else {}
    decisions = current_decisions(load_review(studio_dir, unit.id), questions)
    items = [
        item(q, (flags or {}).get(q.id, []), docs, verdicts.get(q.id), decisions.get(q.id))
        for q in questions.questions
    ]
    items.sort(key=lambda i: (i["rank"], i["id"]))
    return {
        "id": unit.id,
        "title": unit.title,
        "generated": True,
        "checked": flags is not None,
        "verified": verify is not None,
        "stats": stats(items),
        "items": items,
    }


def _question(studio_dir: Path, unit_id: str, qid: str) -> tuple[UnitQuestions, StoredQuestion]:
    questions = load_questions(studio_dir, unit_id)
    found = next((q for q in questions.questions if q.id == qid), None) if questions else None
    if questions is None or found is None:
        raise ReviewError(HTTPStatus.NOT_FOUND, f"no question {qid} in unit {unit_id}")
    return questions, found


def decide(
    studio_dir: Path,
    unit_id: str,
    qid: str,
    decision: Decision | None,
    *,
    content: dict[str, Any] | None = None,
    note: str | None = None,
) -> Decided | None:
    """Record, replace or (with decision None) clear the owner's decision."""
    _, question = _question(studio_dir, unit_id, qid)
    if decision == "accept" and question.schema_error:
        raise ReviewError(HTTPStatus.CONFLICT, "this question fails the import schema; edit it")
    if decision == "edit":
        if not isinstance(content, dict):
            raise ReviewError(HTTPStatus.BAD_REQUEST, "an edit needs the edited content")
        if content.get("type") != question.content["type"]:
            raise ReviewError(HTTPStatus.BAD_REQUEST, "an edit keeps the question type")
        if error := content_error(content):
            raise ReviewError(HTTPStatus.BAD_REQUEST, f"not importable: {error}")
    clean_note = (note or "").strip()[:500] or None
    with _lock:
        review = load_review(studio_dir, unit_id)
        if decision is None:
            review.decisions.pop(qid, None)
            entry = None
        else:
            entry = Decided(
                decision=decision,
                content_hash=content_hash(question.content),
                content=content if decision == "edit" else None,
                note=clean_note,
                decided_at=now(),
            )
            review.decisions[qid] = entry
        write_json(review_path(studio_dir, unit_id), review)
    return entry


def accept_unflagged(studio_dir: Path, unit: Unit, docs: dict[str, PdfPages]) -> int:
    """Accept every unflagged, undecided question once the sample allows it."""
    with _lock:
        view = unit_view(studio_dir, unit, docs)
        if not view["generated"] or not view["checked"]:
            raise ReviewError(HTTPStatus.CONFLICT, "run `studio check` on this unit first")
        s = view["stats"]
        if s["rejected_in_sample"]:
            raise ReviewError(
                HTTPStatus.CONFLICT,
                "a sampled unflagged question was rejected; review this unit one by one",
            )
        if not s["bulk_allowed"]:
            short = s["sample_needed"] - s["unflagged_reviewed"]
            raise ReviewError(HTTPStatus.CONFLICT, f"review {short} more unflagged questions first")
        review = load_review(studio_dir, unit.id)
        accepted = 0
        for entry in view["items"]:
            if entry["flagged"] or entry["decision"] or entry["schema_error"]:
                continue
            review.decisions[entry["id"]] = Decided(
                decision="accept",
                content_hash=content_hash(entry["content"]),
                bulk=True,
                decided_at=now(),
            )
            accepted += 1
        write_json(review_path(studio_dir, unit.id), review)
    return accepted


def static_file(name: str) -> bytes:
    return (resources.files("studio") / "static" / name).read_bytes()


def make_server(
    studio_dir: Path,
    course: CourseFile,
    docs: dict[str, PdfPages],
    *,
    port: int = 0,
    token: str | None = None,
) -> tuple[ThreadingHTTPServer, str]:
    """A review server on 127.0.0.1 and its secret token; the caller runs it."""
    secret = token or secrets.token_urlsafe(24)
    units = {u.id: u for u in course.units}

    class Handler(BaseHTTPRequestHandler):
        server_version = "studio-review"

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            pass

        def _send(self, status: HTTPStatus, body: bytes, kind: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", POLICY)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: HTTPStatus, data: object) -> None:
            body = json.dumps(data, ensure_ascii=False).encode()
            self._send(status, body, "application/json; charset=utf-8")

        def _host_ok(self) -> bool:
            port_now = getattr(self.server, "server_port", None)
            return self.headers.get("Host") in (f"127.0.0.1:{port_now}", f"localhost:{port_now}")

        def _guard(self) -> bool:
            if not self._host_ok():
                self._json(HTTPStatus.FORBIDDEN, {"error": "unexpected Host"})
                return False
            if not self.path.startswith("/api/"):
                return True
            given = self.headers.get("X-Studio-Token", "")
            if not secrets.compare_digest(given, secret):
                self._json(HTTPStatus.FORBIDDEN, {"error": "missing or wrong token"})
                return False
            return True

        def _unit(self, unit_id: str) -> Unit:
            unit = units.get(unit_id)
            if unit is None:
                raise ReviewError(HTTPStatus.NOT_FOUND, f"no unit {unit_id}")
            return unit

        def do_GET(self) -> None:  # noqa: N802
            if not self._guard():
                return
            path = self.path.split("?", 1)[0]
            try:
                if path in STATIC:
                    name, kind = STATIC[path]
                    self._send(HTTPStatus.OK, static_file(name), kind)
                elif path == "/api/units":
                    listing = []
                    for unit in course.units:
                        view = unit_view(studio_dir, unit, docs)
                        listing.append(
                            {
                                "id": unit.id,
                                "title": unit.title,
                                "generated": view["generated"],
                                "stats": view.get("stats"),
                            }
                        )
                    self._json(HTTPStatus.OK, {"course": course.course.name, "units": listing})
                elif path.startswith("/api/units/") and path.count("/") == 3:
                    unit = self._unit(path.rsplit("/", 1)[1])
                    self._json(HTTPStatus.OK, unit_view(studio_dir, unit, docs))
                else:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            except StudioError as exc:
                status = exc.status if isinstance(exc, ReviewError) else HTTPStatus.CONFLICT
                self._json(status, {"error": str(exc)})

        def do_POST(self) -> None:  # noqa: N802
            # Read the body before any refusal: answering with unread request data on the
            # socket makes Windows reset the connection instead of delivering the answer.
            try:
                length = max(0, int(self.headers.get("Content-Length") or 0))
            except ValueError:
                length = 0
            if length > MAX_BODY:
                self.close_connection = True
                self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "body too large"})
                return
            raw = self.rfile.read(length)
            if not self._guard():
                return
            parts = self.path.split("?", 1)[0].strip("/").split("/")
            try:
                if not self.headers.get("Content-Type", "").startswith("application/json"):
                    raise ReviewError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "send JSON")
                try:
                    body = json.loads(raw or b"{}")
                except ValueError:
                    raise ReviewError(HTTPStatus.BAD_REQUEST, "invalid JSON") from None
                if not isinstance(body, dict):
                    raise ReviewError(HTTPStatus.BAD_REQUEST, "send a JSON object")
                if len(parts) == 5 and parts[:2] == ["api", "units"] and parts[3] == "questions":
                    unit = self._unit(parts[2])
                    choice = body.get("decision")
                    if choice not in ("accept", "edit", "reject", None):
                        raise ReviewError(HTTPStatus.BAD_REQUEST, "unknown decision")
                    entry = decide(
                        studio_dir,
                        unit.id,
                        parts[4],
                        choice,
                        content=body.get("content"),
                        note=body.get("note") if isinstance(body.get("note"), str) else None,
                    )
                    self._json(HTTPStatus.OK, {"decision": entry.model_dump() if entry else None})
                elif (
                    len(parts) == 4
                    and parts[:2] == ["api", "units"]
                    and parts[3] == ("accept-unflagged")
                ):
                    accepted = accept_unflagged(studio_dir, self._unit(parts[2]), docs)
                    self._json(HTTPStatus.OK, {"accepted": accepted})
                else:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            except StudioError as exc:
                status = exc.status if isinstance(exc, ReviewError) else HTTPStatus.CONFLICT
                self._json(status, {"error": str(exc)})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    return server, secret
