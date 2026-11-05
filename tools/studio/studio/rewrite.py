"""Rephrase question text that still points at its source after the deterministic cleanup.

Only the flagged text fields go back to the model, and only those come back: the type,
the options' order and correctness, the true/false answer and numeric values are never
part of the reply, so the answer key cannot change. A rewrite that still cites a source,
comes back empty or breaks the application schema is dropped and the old text kept.
"""

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict

from studio.appschema import content_error
from studio.llm import ChatClient, LLMError
from studio.prompts import REWRITE_SYSTEM, REWRITE_VERSION, rewrite_user
from studio.sources import phrase, references, strip_content

BATCH = 10


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NewText(Strict):
    field: str
    text: str


class Rewritten(Strict):
    id: str
    fields: list[NewText]


class RewriteBatch(Strict):
    questions: list[Rewritten]


@dataclass
class Outcome:
    """Per question id: the content to keep, and the fields that still cite a source."""

    contents: dict[str, dict[str, Any]] = field(default_factory=dict)
    left: dict[str, list[str]] = field(default_factory=dict)
    calls: int = 0
    errors: list[str] = field(default_factory=list)


def set_text(content: dict[str, Any], name: str, text: str) -> dict[str, Any]:
    updated = dict(content)
    if name.startswith("options."):
        index = int(name.split(".", 1)[1])
        updated["options"] = [
            {**o, "text": text} if i == index else o for i, o in enumerate(content["options"])
        ]
    else:
        updated[name] = text
    return updated


def request_item(qid: str, content: dict[str, Any], fix: list[str]) -> dict[str, Any]:
    item: dict[str, Any] = {"id": qid, "type": content["type"], "stem": content["stem"]}
    if content.get("options"):
        item["options"] = [
            {"field": f"options.{i}", "text": o["text"], "correct": o["is_correct"]}
            for i, o in enumerate(content["options"])
        ]
    for name in ("correct_answer", "reference_answer", "correct_value", "explanation"):
        if content.get(name) is not None:
            item[name] = content[name]
    item["rewrite"] = fix
    return item


def apply(content: dict[str, Any], fix: list[str], reply: Rewritten | None) -> dict[str, Any]:
    """content with every acceptable rewrite of a flagged field."""
    for new in reply.fields if reply else []:
        text = " ".join(new.text.split())
        if new.field not in fix or not text or phrase(text):
            continue
        candidate = set_text(content, new.field, text)
        if content_error(candidate) is None:
            content = candidate
    return content


def rewrite(
    questions: dict[str, dict[str, Any]], client: ChatClient | None, subject: str
) -> Outcome:
    """Strip every question, then have the model rephrase what still cites a source.

    Without a client only the deterministic cleanup runs.
    """
    outcome = Outcome()
    pending: dict[str, list[str]] = {}
    for qid, content in questions.items():
        cleaned = strip_content(content)
        if content_error(cleaned) is not None and content_error(content) is None:
            cleaned = content
        outcome.contents[qid] = cleaned
        if fix := sorted(references(cleaned)):
            pending[qid] = fix
    ids = list(pending) if client is not None else []
    for start in range(0, len(ids), BATCH):
        chunk = ids[start : start + BATCH]
        items = [request_item(q, outcome.contents[q], pending[q]) for q in chunk]
        outcome.calls += 1
        try:
            batch = client.complete_json(  # type: ignore[union-attr]
                system=REWRITE_SYSTEM,
                user=rewrite_user(items),
                response_model=RewriteBatch,
                prompt_version=REWRITE_VERSION,
                subject=f"{subject} rewrite {start // BATCH + 1}",
            )
        except LLMError as exc:
            outcome.errors.append(exc.code)
            continue
        replies = {r.id: r for r in batch.questions}
        for qid in chunk:
            outcome.contents[qid] = apply(outcome.contents[qid], pending[qid], replies.get(qid))
    for qid, content in outcome.contents.items():
        if still := sorted(references(content)):
            outcome.left[qid] = still
    return outcome
