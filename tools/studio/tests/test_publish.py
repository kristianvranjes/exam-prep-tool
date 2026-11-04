import json
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
from test_generate import FakeGenerator, run
from test_review import COURSE

from studio.appschema import import_error
from studio.config import App, StudioError
from studio.course import CourseFile, Unit
from studio.generate import load_questions, questions_path
from studio.publish import load_manifest, publish
from studio.push import PushResult, load_ledger, match_unit, plan, push
from studio.review import decide

COURSE_ID = "11111111-2222-3333-4444-555555555555"
APP_UNIT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
APP = App(
    api_url="https://api.example.test",
    origin="https://app.example.test",
    course_id=COURSE_ID,
    email="owner@example.test",
)
UNIT = COURSE.units[0]


@pytest.fixture
def studio_dir(tmp_path: Path) -> Path:
    run(FakeGenerator(), tmp_path)
    return tmp_path


def ids(studio_dir: Path) -> list[str]:
    questions = load_questions(studio_dir, "01")
    assert questions is not None
    return sorted(q.id for q in questions.questions)


def content_of(studio_dir: Path, qid: str) -> dict[str, Any]:
    questions = load_questions(studio_dir, "01")
    assert questions is not None
    return next(dict(q.content) for q in questions.questions if q.id == qid)


def test_only_accepted_questions_are_published(studio_dir: Path) -> None:
    first, second, third = ids(studio_dir)[:3]
    decide(studio_dir, "01", first, "accept")
    edited = content_of(studio_dir, second) | {"stem": "Uredeno pitanje o kljucu?"}
    decide(studio_dir, "01", second, "edit", content=edited)
    decide(studio_dir, "01", third, "reject")

    manifest = publish(studio_dir, COURSE, [UNIT])
    [entry] = manifest.units
    assert (entry.questions, entry.rejected, entry.undecided) == (2, 1, 17)
    assert [p.id for p in entry.provenance] == [first, second]
    assert entry.provenance[0].pdf == "u" and entry.provenance[0].page is not None

    assert entry.file is not None
    document = json.loads((studio_dir / "out" / entry.file).read_text(encoding="utf-8"))
    assert document["version"] == "quiz-import-v2" and import_error(document) is None
    assert [q["stem"] for q in document["questions"]][1] == "Uredeno pitanje o kljucu?"
    assert all(None not in q.values() for q in document["questions"])
    assert load_manifest(studio_dir) == manifest


def test_a_unit_with_nothing_accepted_loses_its_old_file(studio_dir: Path) -> None:
    first = ids(studio_dir)[0]
    decide(studio_dir, "01", first, "accept")
    old = publish(studio_dir, COURSE, [UNIT]).units[0].file
    assert old is not None and (studio_dir / "out" / old).is_file()
    decide(studio_dir, "01", first, "reject")
    assert publish(studio_dir, COURSE, [UNIT]).units[0].file is None
    assert not (studio_dir / "out" / old).exists()


def test_duplicate_stems_in_a_unit_stop_publishing(studio_dir: Path) -> None:
    first, second = ids(studio_dir)[:2]
    path = questions_path(studio_dir, "01")
    data = json.loads(path.read_text(encoding="utf-8"))
    by_id = {q["id"]: q for q in data["questions"]}
    by_id[second]["content"]["stem"] = by_id[first]["content"]["stem"]
    path.write_text(json.dumps(data), encoding="utf-8")
    decide(studio_dir, "01", first, "accept")
    decide(studio_dir, "01", second, "accept")
    with pytest.raises(StudioError, match="Duplicate question stems"):
        publish(studio_dir, COURSE, [UNIT])
    assert not (studio_dir / "out").exists()


class FakeApp:
    """The ExamPrep API as far as `studio push` uses it."""

    def __init__(
        self, *, moderator: bool = True, units: list[dict[str, Any]] | None = None
    ) -> None:
        self.moderator = moderator
        self.units = units or [
            {"id": APP_UNIT, "title": "K", "is_archived": False},
            {"id": str(uuid.uuid4()), "title": "Drugo", "is_archived": False},
        ]
        self.imports: list[tuple[list[str], dict[str, Any]]] = []
        self.approved: list[list[str]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "POST" and request.headers.get("Origin") != APP.origin:
            return httpx.Response(403, json={"detail": "Trusted Origin required"})
        if path == "/auth/login":
            body = json.loads(request.content)
            if (body["email"], body["password"]) != (APP.email, "tajna"):
                return httpx.Response(401, json={"detail": "Invalid email or password"})
            cookie = {"Set-Cookie": "examprep_session=s1; Path=/"}
            return httpx.Response(200, json={}, headers=cookie)
        if request.headers.get("Cookie") != "examprep_session=s1":
            return httpx.Response(401, json={"detail": "Not authenticated"})
        if path == f"/courses/{COURSE_ID}/units":
            return httpx.Response(200, json=self.units)
        if path == f"/courses/{COURSE_ID}/questions/import":
            assert request.headers["Content-Type"] == "application/json"
            document = json.loads(request.content)
            self.imports.append((request.url.params.get_list("unit_ids"), document))
            created = [
                {"id": str(uuid.uuid4()), "stem": q["stem"].strip(), "status": "DRAFT"}
                for q in document["questions"]
            ]
            return httpx.Response(201, json=created)
        if path == f"/courses/{COURSE_ID}/questions/transition":
            if not self.moderator:
                return httpx.Response(403, json={"detail": "Faculty moderator access required"})
            body = json.loads(request.content)
            assert body["action"] == "approve" and len(body["question_ids"]) <= 50
            self.approved.append(body["question_ids"])
            return httpx.Response(200, json={"changed": len(body["question_ids"])})
        return httpx.Response(404, json={"detail": "Not Found"})


def push_with(
    app: FakeApp, studio_dir: Path, *, approve: bool = False, password: str = "tajna"
) -> list[PushResult]:
    transport = httpx.MockTransport(app)
    return push(studio_dir, APP, [UNIT], password, approve=approve, transport=transport)


def test_push_imports_only_questions_not_pushed_before(studio_dir: Path) -> None:
    all_ids = ids(studio_dir)
    for qid in all_ids[:3]:
        decide(studio_dir, "01", qid, "accept")
    api = FakeApp()
    [result] = push_with(api, studio_dir)
    assert (result.imported, result.app_unit, result.note) == (3, APP_UNIT, None)
    [(unit_ids, document)] = api.imports
    assert unit_ids == [APP_UNIT] and len(document["questions"]) == 3

    assert push_with(api, studio_dir) == []
    assert len(api.imports) == 1

    decide(studio_dir, "01", all_ids[3], "accept")
    assert [len(p.new) for p in plan(studio_dir, APP, [UNIT])] == [1]
    [again] = push_with(api, studio_dir)
    assert again.imported == 1 and len(api.imports[-1][1]["questions"]) == 1
    ledger = load_ledger(studio_dir, APP)
    assert sum(len(p.questions) for p in ledger.pushes) == 4


def test_push_can_approve_and_falls_back_to_drafts(studio_dir: Path) -> None:
    for qid in ids(studio_dir)[:2]:
        decide(studio_dir, "01", qid, "accept")
    [denied] = push_with(FakeApp(moderator=False), studio_dir, approve=True)
    assert denied.imported == 2 and denied.approved == 0
    assert denied.note is not None and "imported as drafts" in denied.note

    decide(studio_dir, "01", ids(studio_dir)[2], "accept")
    api = FakeApp()
    [approved] = push_with(api, studio_dir, approve=True)
    assert approved.approved == 1 and len(api.approved) == 1


def test_a_wrong_password_imports_nothing(studio_dir: Path) -> None:
    decide(studio_dir, "01", ids(studio_dir)[0], "accept")
    api = FakeApp()
    with pytest.raises(StudioError, match="sign-in failed: HTTP 401 Invalid email or password"):
        push_with(api, studio_dir, password="kriva")
    assert api.imports == [] and not load_ledger(studio_dir, APP).pushes


def test_units_are_matched_by_app_unit_or_a_unique_title() -> None:
    units = [
        {"id": APP_UNIT, "title": "Simetrična kriptografija", "is_archived": False},
        {"id": str(uuid.uuid4()), "title": "AES", "is_archived": False},
        {"id": str(uuid.uuid4()), "title": "AES", "is_archived": False},
    ]
    by_title = Unit(id="01", title="Simetricna  kriptografija", sources=UNIT.sources)
    assert match_unit(by_title, units) == APP_UNIT
    with pytest.raises(StudioError, match="set app_unit"):
        match_unit(Unit(id="02", title="AES", sources=UNIT.sources), units)
    explicit = Unit(id="02", title="AES", sources=UNIT.sources, app_unit=APP_UNIT)
    assert match_unit(explicit, units) == APP_UNIT


def test_unmatched_units_stop_the_push_before_any_import(studio_dir: Path) -> None:
    decide(studio_dir, "01", ids(studio_dir)[0], "accept")
    api = FakeApp(units=[{"id": APP_UNIT, "title": "Nešto drugo", "is_archived": False}])
    with pytest.raises(StudioError, match="no single application unit"):
        push_with(api, studio_dir)
    assert api.imports == []


@pytest.mark.parametrize(
    ("api_url", "ok"),
    [
        ("https://api.example.org", True),
        ("http://localhost:8000", True),
        ("http://127.0.0.1:8000", True),
        ("http://api.example.org", False),
        ("https://user:pass@api.example.org", False),
    ],
)
def test_the_api_must_be_https_unless_local(api_url: str, ok: bool) -> None:
    settings = {
        "api_url": api_url,
        "origin": "https://app.example.org",
        "course_id": COURSE_ID,
        "email": "o@x.hr",
    }
    if ok:
        App.model_validate(settings)
    else:
        with pytest.raises(ValueError, match="https"):
            App.model_validate(settings)


def test_course_files_accept_an_app_unit() -> None:
    unit = UNIT.model_dump(exclude_none=True)
    data = COURSE.model_dump(exclude_none=True)
    assert CourseFile.model_validate(data | {"units": [unit | {"app_unit": APP_UNIT}]})
    with pytest.raises(ValueError):
        CourseFile.model_validate(data | {"units": [unit | {"app_unit": "x"}]})
