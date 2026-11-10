import json
from pathlib import Path
from typing import Any

import httpx

from studio.config import Course, Provider, Questions, Stage
from studio.course import CourseFile, SourceRange, Unit
from studio.exams import (
    ExamDoc,
    ExamPage,
    ExamsResult,
    Extracted,
    XItem,
    XOption,
    exams_dir,
    group,
    keyed_document,
    mark_bold,
    missing_context,
    run_exams,
)
from studio.generate import generate_unit, load_questions
from studio.ingest import Page, PdfPages
from studio.llm import ChatClient
from studio.prompts import EXTRACT_SYSTEM

LEX = "Program LEX na ulazu prima definiciju leksičkog analizatora i gradi leksički analizator."
HEAP = "Gomila je dio memorije koji se dinamički dodjeljuje tijekom izvođenja programa."


def lecture() -> dict[str, PdfPages]:
    texts = [LEX, "Leksička analiza grupira znakove u leksičke jedinke.", HEAP, "Stog i gomila."]
    return {
        "ppj": PdfPages(
            version="studio-pages-v1",
            slug="ppj",
            source="ppj.pdf",
            sha256="0" * 64,
            page_count=len(texts),
            outline=[],
            repeated_lines=[],
            pages=[Page(page=i, text=t, body=t, flags=[]) for i, t in enumerate(texts, start=1)],
        )
    }


COURSE = CourseFile(
    version="studio-course-v1",
    course=Course(name="PPJ", code="PPJ"),
    units=[
        Unit(id="01", title="Leksička analiza", sources=[SourceRange(pdf="ppj", pages="1-2")]),
        Unit(id="02", title="Potpora izvođenju", sources=[SourceRange(pdf="ppj", pages="3-4")]),
    ],
)


def test_bold_runs_are_marked_per_line_and_keep_symbols() -> None:
    def chars(text: str, bold: str) -> list[tuple[str, bool]]:
        return [(c, b == "B") for c, b in zip(text, bold, strict=True)]

    assert mark_bold(chars("a. A\nb. Glavni\n", "....\nBBBBBBBBB\n")) == "a. A\n**b. Glavni**\n"
    # A symbol in a regular font inside a bold formula does not split the run.
    assert mark_bold(chars("d. <X>h", "BBB.B.B")) == "**d. <X>h**"
    # Bold words with plain spaces between them are one run; a plain word ends it.
    assert mark_bold(chars("x  y z", "B..B..")) == "**x  y** z"


def item(stem: str, options: list[tuple[str, bool]], **extra: Any) -> XItem:
    fields: dict[str, Any] = {
        "number": "1",
        "page": 1,
        "kind": "choice",
        "original": stem,
        "stem": stem,
        "options": [XOption(original=t, text=t, marked=m) for t, m in options],
        "answer": None,
        "unit": "01",
    } | extra
    return XItem(**fields)


def test_a_document_counts_as_keyed_only_when_bold_marks_most_answers() -> None:
    marked = [
        item("Što je ulaz u LEX?", [("Stablo", False), ("Definicija", True)]),
        item("Drugo pitanje?", [("a", True), ("b", False)]),
    ]
    assert keyed_document(marked)
    assert not keyed_document([item("Naslov?", [("x", True), ("y", True)])])
    assert not keyed_document([item("Bez rješenja?", [("x", False), ("y", False)])])


def test_the_same_question_from_several_papers_is_one_question() -> None:
    def doc(file: str, items: list[XItem]) -> Extracted:
        return Extracted(
            version="studio-exam-extract-v1", file=file, input_hash="", windows=[], items=items
        )

    recalled = item(
        "Sto je ulaz u program LEX",
        [("Sintaksno stablo", False), ("Definicija leksickog analizatora", False)],
    )
    no_options = item("Što je ulaz u program LEX?", [], kind="short", number="2")
    keyed = item(
        "Što je ulaz u program LEX?",
        [("Sintaksno stablo", False), ("Definicija leksičkog analizatora", True)],
        number="6",
    )
    found = group(
        [(doc("jir.pdf", [recalled, no_options]), False), (doc("teorija.pdf", [keyed]), True)],
        {"01", "02"},
    )
    assert len(found) == 1
    assert found[0].keyed and found[0].item.number == "6"
    assert [a.file for a in found[0].appearances] == ["jir.pdf", "jir.pdf", "teorija.pdf"]


def reply(body: dict[str, Any]) -> httpx.Response:
    content = json.dumps(body, ensure_ascii=False)
    return httpx.Response(
        200, json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}]}
    )


class FakeModel:
    """Transcribes the fake exam pages and answers key requests with canned replies."""

    def __init__(self, extract: dict[str, list[dict[str, Any]]], keys: dict[str, dict[str, Any]]):
        self.extract = extract
        self.keys = keys
        self.requests: list[dict[str, Any]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        payload = json.loads(json.loads(request.content)["messages"][1]["content"])
        self.requests.append(payload)
        if "file" in payload:
            return reply({"items": self.extract[payload["file"]]})
        if "rewrite" in payload["questions"][0]:
            fields = [{"field": "explanation", "text": "LEX gradi analizator iz definicije."}]
            return reply(
                {"questions": [{"id": q["id"], "fields": fields} for q in payload["questions"]]}
            )
        defaults = {
            "truth": None,
            "reference_answer": None,
            "difficulty": 2,
            "page": "P1",
            "problem": None,
        }
        answers = []
        for q in payload["questions"]:
            canned = self.keys[str(q["stem"])]
            # Cite the page that holds the quote, as a model would.
            label = next(p["label"] for p in payload["pages"] if canned["quote"] in p["text"])
            answers.append({"id": q["id"]} | defaults | {"page": label} | canned)
        return reply({"answers": answers})


def client_for(handler: Any, tmp_path: Path) -> ChatClient:
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


def exam(file: str) -> ExamDoc:
    return ExamDoc(
        version="studio-exam-doc-v1",
        file=file,
        slug=file.removesuffix(".pdf"),
        sha256="1" * 64,
        pages=[ExamPage(page=1, text=f"Tekst ispita {file}", ocr=False)],
    )


def option(text: str, marked: bool = False) -> dict[str, Any]:
    return {"original": text, "text": text, "marked": marked}


def entry(
    number: str, kind: str, stem: str, unit: str, options: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "number": number,
        "page": 1,
        "kind": kind,
        "original": stem,
        "stem": stem,
        "options": options,
        "answer": None,
        "unit": unit,
    }


LEX_STEM = "Što je ulaz u program LEX?"
KEY_STEM = "Koliko bitova ima ključ?"
HEAP_STEM = "Što od navedenog vrijedi za gomilu?"


def model() -> FakeModel:
    lex_options = [option("Sintaksno stablo"), option("Definicija leksičkog analizatora", True)]
    heap_options = [option("Dinamički dodijeljena memorija"), option("Područje za statičke")]
    return FakeModel(
        extract={
            "teorija.pdf": [
                entry("1", "choice", LEX_STEM, "01", lex_options),
                entry("2", "choice", KEY_STEM, "01", [option("56", True), option("128")]),
            ],
            "zi.pdf": [
                entry("1", "choice", HEAP_STEM, "02", heap_options),
                entry("2", "task", "Za gramatiku izgradite potisni automat.", "01", []),
                entry("3", "incomplete", "Onaj zadatak s Pi", "01", []),
            ],
        },
        keys={
            LEX_STEM: {"correct": [2], "explanation": "LEX gradi analizator.", "quote": LEX[:60]},
            # The slides point elsewhere than the marked key: kept, flagged for review.
            KEY_STEM: {"correct": [2], "explanation": "Ključ ima 128 bitova.", "quote": LEX[:40]},
            HEAP_STEM: {"correct": [1], "explanation": "Gomila je dinamička.", "quote": HEAP[:50]},
        },
    )


def run(handler: FakeModel, tmp_path: Path) -> ExamsResult:
    return run_exams(
        studio_dir=tmp_path,
        course_name="PPJ",
        course=COURSE,
        docs=lecture(),
        exam_docs=[exam("teorija.pdf"), exam("zi.pdf")],
        make_client=lambda: client_for(handler, tmp_path),
        questions_per_call=6,
    )


def test_exam_questions_join_their_units_with_keys_and_origins(tmp_path: Path) -> None:
    result = run(model(), tmp_path)

    assert result.errors == [] and result.added == {"01": 2, "02": 1}
    assert result.skipped == [] and len(result.tasks) == 1
    lex_unit = load_questions(tmp_path, "01")
    assert lex_unit is not None
    by_stem = {q.content["stem"]: q for q in lex_unit.questions}

    lex = by_stem[LEX_STEM]
    assert lex.origin is not None and lex.origin.key == "marked" and lex.origin.flags == []
    assert [o["is_correct"] for o in lex.content["options"]] == [False, True]
    assert lex.source is not None and (lex.source.pdf, lex.source.page) == ("ppj", 1)
    assert lex.schema_error is None and lex.window == 0

    disputed = by_stem[KEY_STEM]
    assert [o["is_correct"] for o in disputed.content["options"]] == [True, False]
    assert disputed.origin is not None
    assert [f.code for f in disputed.origin.flags] == ["exam_key_disputed"]

    heap_unit = load_questions(tmp_path, "02")
    assert heap_unit is not None
    heap = heap_unit.questions[0]
    assert heap.origin is not None and heap.origin.key == "model"
    assert [o["is_correct"] for o in heap.content["options"]] == [True, False]

    tasks = (exams_dir(tmp_path) / "tasks.md").read_text(encoding="utf-8")
    assert "zi.pdf, zadatak 2: Za gramatiku izgradite potisni automat." in tasks

    # Unchanged documents and questions are not sent again.
    again = model()
    assert run(again, tmp_path).calls == 0 and again.requests == []


def test_generation_keeps_the_exam_questions(tmp_path: Path) -> None:
    run(model(), tmp_path)

    def generator(request: httpx.Request) -> httpx.Response:
        return reply({"questions": []})

    generate_unit(
        course_name="PPJ",
        unit=COURSE.units[0],
        docs=lecture(),
        blueprint=Questions(min_per_unit=1, types={"MULTIPLE_CHOICE": 1}),
        client=client_for(generator, tmp_path),
        studio_dir=tmp_path,
    )
    kept = load_questions(tmp_path, "01")
    assert kept is not None
    assert {q.content["stem"] for q in kept.questions} == {LEX_STEM, KEY_STEM}


def test_a_question_moves_to_the_unit_of_the_slide_that_supports_it(tmp_path: Path) -> None:
    handler = model()
    # The model files the heap question under lexical analysis; its slide is in unit 02.
    handler.extract["zi.pdf"][0]["unit"] = "01"
    result = run(handler, tmp_path)
    assert result.added == {"01": 2, "02": 1}
    heap_unit = load_questions(tmp_path, "02")
    assert heap_unit is not None
    heap = heap_unit.questions[0]
    assert heap.id.startswith("02-x") and heap.origin is not None
    assert [f.code for f in heap.origin.flags] == ["exam_unit_moved"]


def test_explanations_that_cite_the_slides_are_reworded_once(tmp_path: Path) -> None:
    handler = model()
    handler.keys[LEX_STEM]["explanation"] = "Izvor navodi dva ulaza: definiciju i pravila."
    run(handler, tmp_path)
    rewrites = [r for r in handler.requests if "questions" in r and "rewrite" in r["questions"][0]]
    assert len(rewrites) == 1
    lex_unit = load_questions(tmp_path, "01")
    assert lex_unit is not None
    lex = next(q for q in lex_unit.questions if q.content["stem"] == LEX_STEM)
    assert lex.content["explanation"] == "LEX gradi analizator iz definicije."

    again = model()
    again.keys[LEX_STEM]["explanation"] = "Izvor navodi dva ulaza: definiciju i pravila."
    assert run(again, tmp_path).calls == 0


def test_a_marked_key_without_a_slide_is_a_warning_not_an_error(tmp_path: Path) -> None:
    from studio.checks import exam_grounding

    run(model(), tmp_path)
    lex_unit = load_questions(tmp_path, "01")
    assert lex_unit is not None
    lex = next(q for q in lex_unit.questions if q.content["stem"] == LEX_STEM)
    lex.source = None
    assert [(f.code, f.severity) for f in exam_grounding(lex, lecture())] == [
        ("exam_no_slide", "warn")
    ]
    assert lex.origin is not None
    lex.origin.key = "model"
    assert [(f.code, f.severity) for f in exam_grounding(lex, lecture())] == [
        ("no_source", "error")
    ]


def test_points_copied_options_and_spelling_variants_do_not_split_a_question() -> None:
    def doc(file: str, items: list[XItem]) -> Extracted:
        return Extracted(
            version="studio-exam-extract-v1", file=file, input_hash="", windows=[], items=items
        )

    options = ["Izrada adresa podacima", "Dodjela registara podacima", "Izbor redoslijeda"]
    variant = ["izrada adresa podatcima", "dodjela registra podacima", "izbor redoslijeda"]
    first = item(
        "(4 boda) Koji postupak nije dio generatora?", [(t, False) for t in options], number="3"
    )
    second = item(
        "Koji postupak nije dio generatora\na) izrada adresa podatcima\nb) dodjela",
        [(t, False) for t in variant],
        number="11",
    )
    found = group([(doc("ljir.pdf", [first]), False), (doc("jir.pdf", [second]), False)], {"01"})
    assert len(found) == 1
    assert found[0].item.stem == "Koji postupak nije dio generatora?"
    assert len(found[0].appearances) == 2


def test_a_rerun_keeps_reviewed_questions_exactly_as_they_are(tmp_path: Path) -> None:
    run(model(), tmp_path)
    before = load_questions(tmp_path, "01")
    assert before is not None

    # A changed prompt or model would explain differently; existing questions stay.
    changed = model()
    changed.keys[LEX_STEM]["explanation"] = "Drugačije objašnjenje."
    assert run(changed, tmp_path).calls == 0 and changed.requests == []
    assert load_questions(tmp_path, "01") == before


def test_a_failed_key_request_never_drops_a_question(tmp_path: Path) -> None:
    run(model(), tmp_path)

    retranscribed = model()
    # The LEX question is transcribed differently, so it needs a new key ...
    retranscribed.extract["teorija.pdf"][0]["stem"] = "Što je ulaz programa LEX?"

    def failing(request: httpx.Request) -> httpx.Response:
        payload = json.loads(json.loads(request.content)["messages"][1]["content"])
        if "file" in payload:
            return retranscribed(request)
        return httpx.Response(429, json={"error": {"message": "slow down"}})

    # ... and that request fails: the question stays as it was.
    result = run_exams(
        studio_dir=tmp_path,
        course_name="PPJ",
        course=COURSE,
        docs=lecture(),
        exam_docs=[exam("teorija.pdf"), exam("zi.pdf")],
        make_client=lambda: client_for(failing, tmp_path),
        questions_per_call=6,
        force=True,  # transcribe again
    )
    assert result.errors and result.added == {"01": 2, "02": 1}
    lex_unit = load_questions(tmp_path, "01")
    assert lex_unit is not None
    assert LEX_STEM in {q.content["stem"] for q in lex_unit.questions}


def test_a_decided_question_is_frozen_whatever_the_new_transcription(tmp_path: Path) -> None:
    from studio.review import decide

    run(model(), tmp_path)
    before = load_questions(tmp_path, "01")
    assert before is not None
    lex = next(q for q in before.questions if q.content["stem"] == LEX_STEM)
    decide(tmp_path, "01", lex.id, "accept")

    # The paper is transcribed again with its points note in the stem.
    again = model()
    again.extract["teorija.pdf"][0]["stem"] = "(4 boda) " + LEX_STEM
    again.extract["teorija.pdf"][0]["original"] = "(4 boda) Sto je ulaz u program LEX?"
    run_exams(
        studio_dir=tmp_path,
        course_name="PPJ",
        course=COURSE,
        docs=lecture(),
        exam_docs=[exam("teorija.pdf"), exam("zi.pdf")],
        make_client=lambda: client_for(again, tmp_path),
        questions_per_call=6,
        force=True,
    )
    after = load_questions(tmp_path, "01")
    assert after is not None
    assert [q for q in after.questions if q.id == lex.id] == [lex]
    assert not any("questions" in r for r in again.requests)  # no new key was needed


def test_shared_blocks_are_copied_into_every_item_that_needs_them() -> None:
    # The transcription prompt asks for the block in each item, not only the first.
    assert "copy the whole block verbatim into the item's `stem`" in EXTRACT_SYSTEM
    assert "Do this for each item, not only the first." in EXTRACT_SYSTEM


def test_a_stem_that_points_at_missing_code_or_a_figure_is_flagged() -> None:
    assert missing_context("Na kojim linijama se događa upravljački hazard?")
    assert missing_context("Za zadani graf tijeka izvođenja, koja tvrdnja dominacije je istinita?")
    assert missing_context("Koji se atributi mogu izračunati u stablu danom na slici?")
    assert missing_context("Za program prikazan u donjem dijelu stranice dodjeljuju se registri.")
    # The block or the productions are in the stem itself.
    assert not missing_context(
        "Na kojim linijama se događa hazard?\n```\n1 LDR R0, [R1]\n2 ADD R2, R0, R0\n```"
    )
    assert not missing_context("Za sljedeću gramatiku odredite vrstu: S → Bc; S → cBb; B → ε;")
    assert not missing_context(
        "Zadana je gramatika s produkcijama: S → aASc, S → be, A → ε i A → c. "
        "Čemu je jednak skup PRIMIJENI(A → ε)?"
    )
    assert not missing_context("Koji od navedenih postupaka nije dio generatora ciljnog programa?")
