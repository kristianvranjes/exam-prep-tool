import json
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import pytest
from pdfgen import make_pdf

import studio.cli
from studio.cli import main
from studio.config import Provider, Questions, Stage
from studio.course import SourceRange, Unit
from studio.generate import (
    GenQuestion,
    PageText,
    UnitResult,
    apportion,
    generate_unit,
    load_questions,
    plan_windows,
    shuffle_options,
    to_content,
    unit_counts,
)
from studio.ingest import Page, PdfPages
from studio.llm import ChatClient

FILLER = "Simetricna kriptografija koristi isti kljuc za kriptiranje i dekriptiranje poruka. "


def doc(pages: int, chars: int = 3000) -> PdfPages:
    texts = [f"Stranica {i}. " + FILLER * (chars // len(FILLER)) for i in range(1, pages + 1)]
    return PdfPages(
        version="studio-pages-v1",
        slug="u",
        source="pdf/u.pdf",
        sha256="0" * 64,
        page_count=pages,
        outline=[],
        repeated_lines=[],
        pages=[Page(page=i, text=t, body=t, flags=[]) for i, t in enumerate(texts, start=1)],
    )


def generated(kind: str, stem: str, label: str, quote: str) -> dict[str, Any]:
    question: dict[str, Any] = {
        "type": kind,
        "stem": stem,
        "options": [],
        "correct_answer": None,
        "reference_answer": None,
        "correct_value": None,
        "absolute_tolerance": None,
        "relative_tolerance": None,
        "unit": None,
        "explanation": "Tako pise na slajdu.",
        "difficulty": 2,
        "source": label,
        "quote": quote,
    }
    if kind in ("MULTIPLE_CHOICE", "MULTIPLE_SELECT"):
        correct = {0} if kind == "MULTIPLE_CHOICE" else {0, 2}
        question["options"] = [
            {"text": f"Odgovor {i} za {stem}", "is_correct": i in correct} for i in range(4)
        ]
    elif kind == "TRUE_FALSE":
        question["correct_answer"] = True
    elif kind == "SHORT_ANSWER":
        question["reference_answer"] = "Isti kljuc."
    return question


def reply(questions: list[dict[str, Any]]) -> httpx.Response:
    content = json.dumps({"questions": questions}, ensure_ascii=False)
    return httpx.Response(
        200, json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}]}
    )


class FakeGenerator:
    """Answers each request with exactly the requested questions, citing its sources."""

    def __init__(self, fail_calls: set[int] | None = None) -> None:
        self.requests: list[dict[str, Any]] = []
        self.fail_calls = fail_calls or set()

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        payload = json.loads(body["messages"][1]["content"])
        self.requests.append(payload)
        if len(self.requests) in self.fail_calls:
            return httpx.Response(429, json={"error": {"message": "slow down"}})
        sources = payload["sources"]
        questions = []
        for kind, n in payload["question_counts"].items():
            for k in range(n):
                source = sources[k % len(sources)]
                stem = f"{kind} {k} iz {source['text'][:12]} ({len(self.requests)})"
                questions.append(generated(kind, stem, source["label"], source["text"][:80]))
        return reply(questions)


def client(handler: Callable[[httpx.Request], httpx.Response], tmp_path: Path) -> ChatClient:
    return ChatClient(
        stage_name="generate",
        provider_name="openrouter",
        provider=Provider(base_url="https://openrouter.ai/api/v1", api_key_env="KEY"),
        stage=Stage(
            provider="openrouter", model="deepseek/deepseek-v4-flash", min_interval_seconds=0
        ),
        log_path=tmp_path / "calls.jsonl",
        env={"KEY": "secret-key-123"},
        transport=httpx.MockTransport(handler),
    )


UNIT = Unit(id="01", title="Kriptografija", sources=[SourceRange(pdf="u", pages="1-10")])


def run(
    handler: Callable[[httpx.Request], httpx.Response],
    tmp_path: Path,
    *,
    unit: Unit = UNIT,
    blueprint: Questions | None = None,
) -> UnitResult:
    return generate_unit(
        course_name="SRS",
        unit=unit,
        docs={"u": doc(10)},
        blueprint=blueprint or Questions(),
        client=client(handler, tmp_path),
        studio_dir=tmp_path,
    )


def test_apportion_keeps_the_total_and_follows_weights() -> None:
    assert apportion(5, [1, 1, 1]) == [2, 2, 1]
    assert apportion(3, [0, 0]) == [2, 1]
    assert apportion(12, [3000, 9000]) == [3, 9]
    assert apportion(0, [5, 5]) == [0, 0]


def test_windows_stay_within_limits_and_keep_page_order() -> None:
    pages = [PageText(pdf="u", page=i, text="x" * 3000) for i in range(1, 11)]
    blueprint = Questions(types={"MULTIPLE_CHOICE": 20}, max_questions_per_call=8)
    windows = plan_windows(pages, {"MULTIPLE_CHOICE": 20}, blueprint)
    assert len(windows) >= 3
    assert all(w.chars <= blueprint.max_input_chars for w in windows)
    assert [p.page for w in windows for p in w.pages] == list(range(1, 11))
    assert sum(w.counts["MULTIPLE_CHOICE"] for w in windows) == 20


def test_generation_maps_labels_to_pages_and_validates_with_the_app_schema(
    tmp_path: Path,
) -> None:
    handler = FakeGenerator()
    result = run(handler, tmp_path)
    assert result.state == "generated"
    made = result.questions
    assert len(made.questions) == 20
    assert len(handler.requests) == result.calls == len(made.windows)
    assert all(len(r["sources"]) <= 4 for r in handler.requests)  # 12000 characters each
    assert all(q.schema_error is None for q in made.questions)
    first = made.questions[0]
    assert first.id == "01-w01-01"
    assert first.source is not None and (first.source.pdf, first.source.page) == ("u", 1)
    assert load_questions(tmp_path, "01") == made


def test_unchanged_units_are_not_sent_again(tmp_path: Path) -> None:
    run(FakeGenerator(), tmp_path)
    again = FakeGenerator()
    result = run(again, tmp_path)
    assert result.state == "unchanged" and again.requests == []

    changed = FakeGenerator()
    result = run(changed, tmp_path, blueprint=Questions(types={"TRUE_FALSE": 3}))
    assert result.state == "generated"
    assert len(changed.requests) == result.calls > 0
    assert len(result.questions.questions) == 3


def test_a_rerun_requests_only_the_windows_that_failed(tmp_path: Path) -> None:
    first = run(FakeGenerator(fail_calls={2}), tmp_path)
    assert first.state == "partial"
    assert [w.error for w in first.questions.windows].count("RATE_LIMITED") == 1
    kept = {q.id for q in first.questions.questions}

    retry = FakeGenerator()
    second = run(retry, tmp_path)
    assert second.state == "generated" and len(retry.requests) == 1
    assert kept < {q.id for q in second.questions.questions}
    assert len(second.questions.questions) == 20


def test_invalid_questions_and_unknown_labels_are_recorded_not_repaired(tmp_path: Path) -> None:
    def broken(request: httpx.Request) -> httpx.Response:
        two_keys = generated("MULTIPLE_CHOICE", "Dva kljuca?", "S1", "x")
        for option in two_keys["options"][:2]:
            option["is_correct"] = True
        return reply([two_keys, generated("TRUE_FALSE", "Tvrdnja.", "S99", "x")])

    unit = Unit(
        id="02",
        title="T",
        sources=[SourceRange(pdf="u", pages="1-2")],
        questions={"MULTIPLE_CHOICE": 1, "TRUE_FALSE": 1},
    )
    made = run(broken, tmp_path, unit=unit).questions.questions
    assert made[0].schema_error is not None and "one correct" in made[0].schema_error
    assert made[1].source is None and made[1].schema_error is None


def test_options_are_reordered_deterministically_without_changing_the_key() -> None:
    def content() -> dict[str, Any]:
        return to_content(
            GenQuestion.model_validate(generated("MULTIPLE_CHOICE", "Kljuc?", "S1", "q"))
        )

    original = content()
    first, second = content(), content()
    shuffle_options(first, "01-w01-01")
    shuffle_options(second, "01-w01-01")
    assert first == second
    key = next(o["text"] for o in original["options"] if o["is_correct"])
    assert [o["text"] for o in first["options"] if o["is_correct"]] == [key]
    assert sorted(o["text"] for o in first["options"]) == sorted(
        o["text"] for o in original["options"]
    )
    positions = set()
    for n in range(20):
        shuffled = content()
        shuffle_options(shuffled, f"01-w01-{n:02d}")
        positions.add(next(i for i, o in enumerate(shuffled["options"]) if o["is_correct"]))
    assert positions == {0, 1, 2, 3}


def test_numeric_content_keeps_only_numeric_fields() -> None:
    question = GenQuestion.model_validate(
        generated("NUMERIC", "Koliko bitova?", "S1", "q")
        | {"correct_value": "128", "relative_tolerance": "0.01"}
    )
    assert to_content(question) == {
        "type": "NUMERIC",
        "stem": "Koliko bitova?",
        "explanation": "Tako pise na slajdu.",
        "difficulty": 2,
        "correct_value": "128",
        "relative_tolerance": "0.01",
    }


DECK = [
    ("Simetricna kriptografija", "Isti tajni kljuc sluzi za kriptiranje i dekriptiranje."),
    ("AES", "AES radi nad blokovima od 128 bitova s kljucevima od 128, 192 ili 256 bitova."),
    ("Nacini rada", "ECB kriptira svaki blok zasebno pa jednaki blokovi daju jednak sifrat."),
    ("CBC", "CBC prije kriptiranja XOR-a blok otvorenog teksta s prethodnim blokom sifrata."),
    ("Napadi", "Napad grubom silom isprobava sve kljuceve iz prostora kljuceva redom."),
    (
        "Razmjena kljuca",
        "Simetricni kljuc treba sigurno dostaviti svim stranama prije komunikacije.",
    ),
]


def test_cli_generate_check_and_status(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    pages = [[title, line, f"Primjer: {title.lower()} u praksi."] for title, line in DECK]
    (tmp_path / "pdf").mkdir()
    (tmp_path / "pdf" / "01 Kripto.pdf").write_bytes(make_pdf(pages))
    studio_dir = tmp_path / "studio"
    args = ["--name", "SRS", "--code", "SRS", "--pdfs", "../pdf/*.pdf"]
    assert main(["init", str(studio_dir), *args]) == 0
    assert main(["ingest", str(studio_dir)]) == 0
    assert main(["generate", str(studio_dir)]) == 2  # course.yaml is not confirmed yet
    shutil.copy(studio_dir / "course.proposed.yaml", studio_dir / "course.yaml")
    capsys.readouterr()

    assert main(["generate", str(studio_dir), "--dry-run"]) == 0
    assert "nothing was sent" in capsys.readouterr().out

    handler = FakeGenerator()
    monkeypatch.setattr(studio.cli, "stage_client", lambda *a: client(handler, tmp_path))
    assert main(["generate", str(studio_dir), "--unit", "01"]) == 0
    assert "generated  01 Kripto: 10 questions" in capsys.readouterr().out
    assert main(["status", str(studio_dir)]) == 0
    assert "10 questions, not checked" in capsys.readouterr().out

    # The fake model's options differ by one digit and its keys all come first. The
    # checks report the former; reordering removed the latter. Nothing fails the
    # import schema and every quote is on its page.
    assert main(["check", str(studio_dir)]) == 0
    out = capsys.readouterr().out
    assert "01: 10 questions, 0 errors" in out
    assert "options_too_similar" in out
    assert "answer_position" not in out and "quote_not_found" not in out
    assert main(["status", str(studio_dir)]) == 0
    assert "10 questions, 0 errors" in capsys.readouterr().out


def test_question_counts_can_scale_with_the_unit() -> None:
    scaled = Questions(questions_per_page=0.3, min_per_unit=10, max_per_unit=40)
    assert unit_counts(UNIT, scaled, 85) == {
        "MULTIPLE_CHOICE": 15,
        "TRUE_FALSE": 5,
        "MULTIPLE_SELECT": 3,
        "SHORT_ANSWER": 3,
    }
    assert sum(unit_counts(UNIT, scaled, 6).values()) == 10  # floor
    assert sum(unit_counts(UNIT, scaled, 500).values()) == 40  # ceiling
    assert sum(unit_counts(UNIT, Questions(), 500).values()) == 20  # fixed blueprint
    own = UNIT.model_copy(update={"questions": {"TRUE_FALSE": 7}})
    assert unit_counts(own, scaled, 85) == {"TRUE_FALSE": 7}  # the unit's own counts win
