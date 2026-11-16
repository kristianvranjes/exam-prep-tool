import http.client
import json
import threading
import tomllib
from collections.abc import Iterator
from http import HTTPStatus
from pathlib import Path
from typing import Any

import pytest
from test_generate import FakeGenerator, doc, run
from test_verify import course_for

import studio.review as review
from studio.config import StudioConfig, StudioError, render_template
from studio.generate import load_questions, questions_path
from studio.review import (
    ReviewError,
    accept_unflagged,
    decide,
    highlight,
    load_review,
    make_server,
    unit_view,
)

DOCS = {"u": doc(10)}
COURSE = course_for(
    StudioConfig.model_validate(tomllib.loads(render_template("SRS", "SRS", ["*.pdf"])))
)
UNIT = COURSE.units[0]


@pytest.fixture
def studio_dir(tmp_path: Path) -> Path:
    run(FakeGenerator(), tmp_path)
    return tmp_path


def ids(studio_dir: Path) -> list[str]:
    questions = load_questions(studio_dir, "01")
    assert questions is not None
    return [q.id for q in questions.questions]


def content_of(studio_dir: Path, qid: str) -> dict[str, Any]:
    questions = load_questions(studio_dir, "01")
    assert questions is not None
    return next(dict(q.content) for q in questions.questions if q.id == qid)


def flag_first(monkeypatch: pytest.MonkeyPatch, studio_dir: Path, flagged: int) -> list[str]:
    """Pretend the checks flagged the first `flagged` questions and nothing else."""
    all_ids = ids(studio_dir)
    warn = [{"code": "quote_not_found", "severity": "warn", "detail": "x"}]
    flags = {qid: (warn if i < flagged else []) for i, qid in enumerate(all_ids)}
    monkeypatch.setattr(review, "checks_fresh", lambda *a: flags)
    return all_ids


def test_decisions_are_saved_replaced_and_cleared(studio_dir: Path) -> None:
    first = ids(studio_dir)[0]
    decide(studio_dir, "01", first, "accept")
    assert load_review(studio_dir, "01").decisions[first].decision == "accept"
    decide(studio_dir, "01", first, "reject", note="  Kljuc je pogresan.  ")
    saved = load_review(studio_dir, "01").decisions[first]
    assert (saved.decision, saved.note) == ("reject", "Kljuc je pogresan.")
    decide(studio_dir, "01", first, None)
    assert first not in load_review(studio_dir, "01").decisions


def test_edits_must_pass_the_application_schema_and_keep_the_type(studio_dir: Path) -> None:
    qid = next(q for q in ids(studio_dir) if content_of(studio_dir, q)["type"] == "MULTIPLE_CHOICE")
    edited = content_of(studio_dir, qid)
    for option in edited["options"]:
        option["is_correct"] = True
    with pytest.raises(ReviewError, match="not importable") as raised:
        decide(studio_dir, "01", qid, "edit", content=edited)
    assert raised.value.status == HTTPStatus.BAD_REQUEST
    with pytest.raises(ReviewError, match="keeps the question type"):
        decide(studio_dir, "01", qid, "edit", content={"type": "TRUE_FALSE", "stem": "x"})

    fixed = content_of(studio_dir, qid) | {"stem": "Koji kljuc koristi simetricna kriptografija?"}
    entry = decide(studio_dir, "01", qid, "edit", content=fixed)
    assert entry is not None and entry.content == fixed


def test_a_question_that_fails_the_schema_cannot_be_accepted_as_is(studio_dir: Path) -> None:
    path = questions_path(studio_dir, "01")
    data = json.loads(path.read_text(encoding="utf-8"))
    data["questions"][0]["schema_error"] = "options: Exactly one correct option is required"
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(ReviewError, match="fails the import schema") as raised:
        decide(studio_dir, "01", data["questions"][0]["id"], "accept")
    assert raised.value.status == HTTPStatus.CONFLICT


def test_a_decision_does_not_follow_an_id_to_different_content(studio_dir: Path) -> None:
    first = ids(studio_dir)[0]
    decide(studio_dir, "01", first, "accept")
    path = questions_path(studio_dir, "01")
    data = json.loads(path.read_text(encoding="utf-8"))
    data["questions"][0]["content"]["stem"] = "Sasvim drugo pitanje?"
    path.write_text(json.dumps(data), encoding="utf-8")
    view = unit_view(studio_dir, UNIT, DOCS)
    assert next(i for i in view["items"] if i["id"] == first)["decision"] is None


def test_a_damaged_review_file_is_never_overwritten(studio_dir: Path) -> None:
    decide(studio_dir, "01", ids(studio_dir)[0], "accept")
    path = studio_dir / "build" / "units" / "01" / "review.json"
    path.write_text("{ not json", encoding="utf-8")
    with pytest.raises(StudioError, match="cannot be read"):
        decide(studio_dir, "01", ids(studio_dir)[1], "accept")
    assert path.read_text(encoding="utf-8") == "{ not json"


def test_flagged_questions_come_first_and_the_rest_are_sampled(
    studio_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    all_ids = flag_first(monkeypatch, studio_dir, flagged=5)
    view = unit_view(studio_dir, UNIT, DOCS)
    assert [i["flagged"] for i in view["items"]][:5] == [True] * 5
    assert view["stats"]["sample_needed"] == 3 and not view["stats"]["bulk_allowed"]
    with pytest.raises(ReviewError, match="review 3 more"):
        accept_unflagged(studio_dir, UNIT, DOCS)

    for qid in all_ids[5:8]:
        decide(studio_dir, "01", qid, "accept")
    assert accept_unflagged(studio_dir, UNIT, DOCS) == 12
    decisions = load_review(studio_dir, "01").decisions
    assert all(decisions[q].bulk for q in all_ids[8:])
    assert not any(q in decisions for q in all_ids[:5])


def test_a_rejection_in_the_sample_blocks_bulk_acceptance(
    studio_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    all_ids = flag_first(monkeypatch, studio_dir, flagged=5)
    for qid in all_ids[5:7]:
        decide(studio_dir, "01", qid, "accept")
    decide(studio_dir, "01", all_ids[7], "reject")
    with pytest.raises(ReviewError, match="review this unit one by one"):
        accept_unflagged(studio_dir, UNIT, DOCS)


def test_bulk_acceptance_needs_fresh_checks(studio_dir: Path) -> None:
    with pytest.raises(ReviewError, match="studio check"):
        accept_unflagged(studio_dir, UNIT, DOCS)


def test_the_quote_is_located_in_the_page_text() -> None:
    text = "Uvod\nLeksički analizator čita niz znakova i grupira ih.\nKraj"
    start, end = highlight(text, "leksički analizator čita niz znakova") or (0, 0)
    assert text[start:end] == "Leksički analizator čita niz znakova"
    assert highlight(text, "nešto sasvim drugo ovdje") is None


@pytest.fixture
def server(studio_dir: Path) -> Iterator[tuple[int, str]]:
    httpd, token = make_server(studio_dir, COURSE, DOCS, port=0)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield httpd.server_port, token
    httpd.shutdown()
    httpd.server_close()


def call(
    port: int,
    method: str,
    path: str,
    *,
    token: str | None = None,
    body: object = None,
    host: str | None = None,
    content_type: str = "application/json",
) -> tuple[int, dict[str, str], bytes]:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    headers = {"Host": host or f"127.0.0.1:{port}"}
    if token:
        headers["X-Studio-Token"] = token
    payload = None
    if body is not None:
        payload = json.dumps(body).encode()
        headers["Content-Type"] = content_type
    connection.request(method, path, body=payload, headers=headers)
    response = connection.getresponse()
    result = response.status, dict(response.getheaders()), response.read()
    connection.close()
    return result


def test_the_page_and_assets_are_served_with_a_strict_policy(server: tuple[int, str]) -> None:
    port, _ = server
    status, headers, body = call(port, "GET", "/")
    assert status == 200 and b"app.js" in body
    assert "default-src 'none'" in headers["Content-Security-Policy"]
    status, headers, _ = call(port, "GET", "/app.js")
    assert status == 200 and headers["Content-Type"].startswith("text/javascript")


def test_the_api_needs_the_token_and_a_local_host(server: tuple[int, str]) -> None:
    port, token = server
    assert call(port, "GET", "/api/units")[0] == 403
    assert call(port, "GET", "/api/units", token="wrong")[0] == 403
    assert call(port, "GET", "/api/units", token=token, host="evil.example")[0] == 403
    assert call(port, "GET", "/", host="evil.example")[0] == 403
    status, _, body = call(port, "GET", "/api/units", token=token)
    assert status == 200
    assert json.loads(body)["units"][0]["stats"]["total"] == 20


def test_decisions_through_the_api(server: tuple[int, str], studio_dir: Path) -> None:
    port, token = server
    qid = ids(studio_dir)[0]
    path = f"/api/units/01/questions/{qid}"
    reject = {"decision": "reject", "note": "x"}
    status, _, body = call(port, "POST", path, token=token, body=reject)
    assert status == 200 and json.loads(body)["decision"]["decision"] == "reject"
    assert load_review(studio_dir, "01").decisions[qid].note == "x"

    bad = {"decision": "edit", "content": {"type": content_of(studio_dir, qid)["type"]}}
    status, _, body = call(port, "POST", path, token=token, body=bad)
    assert status == 400 and "not importable" in json.loads(body)["error"]
    assert call(port, "POST", path, token=token, body={"decision": "maybe"})[0] == 400
    assert call(port, "POST", path, token=token, body={}, content_type="text/plain")[0] == 415
    assert call(port, "POST", "/api/units/99/questions/x", token=token, body={})[0] == 404

    status, _, body = call(port, "GET", "/api/units/01", token=token)
    item = next(i for i in json.loads(body)["items"] if i["id"] == qid)
    assert item["decision"]["decision"] == "reject"
    assert item["source"]["page"] >= 1 and item["source"]["highlight"] is not None
