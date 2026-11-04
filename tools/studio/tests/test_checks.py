import json
import tomllib
from pathlib import Path
from typing import Any

import pytest

from studio.checks import (
    Flag,
    balance_flags,
    duplicate_flags,
    fold,
    grounding,
    load_bank,
    option_flags,
    partial_ratio,
    window_flags,
)
from studio.config import StudioConfig, StudioError, render_template
from studio.generate import Source, StoredQuestion, UnitQuestions, WindowRecord
from studio.ingest import Page, PdfPages

PAGE = (
    "Prevo■enje programskih jezika\n"
    "Leksi■ki analizator ■ita niz znakova i grupira ih u leksi■ke jedinke.\n"
    "Sintaksni analizator gradi stablo iz niza jedinki."
)


def docs() -> dict[str, PdfPages]:
    return {
        "ppj": PdfPages(
            version="studio-pages-v1",
            slug="ppj",
            source="ppj.pdf",
            sha256="0" * 64,
            page_count=1,
            outline=[],
            repeated_lines=[],
            pages=[Page(page=1, text=PAGE, body=PAGE, flags=["ocr_noise"])],
        )
    }


def question(
    qid: str = "01-w01-01", *, quote: str | None = None, page: int = 1, **content: Any
) -> StoredQuestion:
    body = {"type": "TRUE_FALSE", "stem": "Tvrdnja.", "correct_answer": True} | content
    source = None if quote is None else Source(pdf="ppj", page=page, quote=quote)
    return StoredQuestion(id=qid, window=1, content=body, source=source, schema_error=None)


def mcq(stem: str, options: list[str], key: int = 0, qid: str = "01-w01-01") -> StoredQuestion:
    return question(
        qid,
        type="MULTIPLE_CHOICE",
        stem=stem,
        options=[{"text": t, "is_correct": i == key} for i, t in enumerate(options)],
    )


def codes(flags: list[Flag]) -> list[str]:
    return [f.code for f in flags]


def units(*questions: StoredQuestion) -> list[UnitQuestions]:
    return [
        UnitQuestions(
            version="studio-questions-v1",
            unit="01",
            title="T",
            prompt_version="questions-v1",
            model="m/m",
            input_hash="h",
            generated_at="2026-11-03T00:00:00Z",
            windows=[],
            questions=list(questions),
        )
    ]


def test_fold_ignores_case_diacritics_and_ocr_placeholders() -> None:
    assert fold("Leksički  analizator!") == "leksicki analizator"
    assert fold("Prevođenje") == "prevodenje"
    assert partial_ratio(fold("Prevođenje programskih"), fold("Prevo■enje programskih")) > 0.9


def test_quote_from_an_ocr_damaged_page_is_still_found() -> None:
    quote = "Leksički analizator čita niz znakova i grupira ih u leksičke jedinke."
    assert grounding(question(quote=quote), docs()) == []


def test_paraphrased_and_invented_quotes_are_flagged() -> None:
    weak = question(quote="Leksički analizator čita niz znakova i spaja ih u jedinke.")
    assert codes(grounding(weak, docs())) == ["quote_weak"]
    invented = question(quote="Optimizator uklanja mrtvi kod iz međukoda programa.")
    [flag] = grounding(invented, docs())
    assert flag.code == "quote_not_found" and "OCR-damaged" in flag.detail


def test_stitched_and_latex_quotes_are_matched_piece_by_piece() -> None:
    stitched = "Leksički analizator čita niz znakova ... Sintaksni analizator gradi stablo"
    assert grounding(question(quote=stitched), docs()) == []
    half_invented = "Leksički analizator čita niz znakova ... Optimizator briše mrtvi kod"
    assert codes(grounding(question(quote=half_invented), docs())) == ["quote_not_found"]
    assert fold(r"$m \in \{0,1\}^n$") == fold("m ∈ {0,1}n") == "m 0 1 n"


@pytest.mark.parametrize(
    ("stem", "flagged"),
    [
        ("Koje su metode navedene u izvoru?", True),
        ("Što se spominje na slajdu o AES-u?", True),
        ("Što je rečeno na predavanju o DES-u?", True),
        ("Što leksički analizator čita iz izvornog koda?", False),
        ("Koju uslugu pruža prezentacijski sloj?", False),
    ],
)
def test_stems_that_point_at_the_sources(stem: str, flagged: bool) -> None:
    from studio.checks import REFERS_TO_SOURCE

    assert bool(REFERS_TO_SOURCE.search(fold(stem))) is flagged


def test_missing_short_and_out_of_range_sources() -> None:
    assert codes(grounding(question(), docs())) == ["no_source"]
    assert codes(grounding(question(quote="analizator"), docs())) == ["quote_short"]
    [flag] = grounding(question(quote="Sintaksni analizator gradi stablo", page=9), docs())
    assert (flag.code, flag.severity) == ("no_source", "error")


def test_duplicates_against_the_bank_and_within_the_course() -> None:
    bank = [("02-leksicka.json #4", fold("Što radi leksički analizator?"))]
    flags = duplicate_flags(
        units(
            question("a", stem="Što radi leksički analizator?"),
            question("b", stem="Što to radi leksički analizator?"),
            question("c", stem="Što radi sintaksni analizator nad stablom?"),
            question("d", stem="Što radi sintaksni analizator nad stablom!"),
        ),
        bank,
    )
    assert codes(flags["a"]) == ["duplicate"]
    assert flags["a"][0].detail == "same stem as 02-leksicka.json #4"
    assert codes(flags["b"]) == ["near_duplicate", "near_duplicate"]
    assert flags["c"] == []
    assert codes(flags["d"]) == ["duplicate"] and flags["d"][0].detail == "same stem as c"


def test_option_heuristics() -> None:
    options = ["Leksičke jedinke", "Stablo", "Sve navedeno", "Stablo."]
    assert codes(option_flags(mcq("Što NIJE izlaz analizatora?", options).content)) == [
        "all_or_none_option",
        "options_too_similar",
        "negated_stem",
        "correct_option_longest",
    ]
    long_key = ["Niz leksičkih jedinki s položajem u izvornom kodu", "Stablo", "Kod", "Graf"]
    assert codes(option_flags(mcq("Izlaz?", long_key).content)) == ["correct_option_longest"]
    assert option_flags(question().content) == []


def test_unit_balance_and_blueprint() -> None:
    true_false = [question(f"t{i}", stem=f"Tvrdnja {i}.") for i in range(5)]
    first_key = [mcq(f"Pitanje {i}?", ["A", "B", "C", "D"], qid=f"m{i}") for i in range(6)]
    flags = balance_flags({"TRUE_FALSE": 5, "MULTIPLE_CHOICE": 8}, true_false + first_key)
    assert [(f.code, f.detail) for f in flags] == [
        ("blueprint_short", "MULTIPLE_CHOICE 6/8"),
        ("true_false_balance", "5 of 5 true"),
        ("answer_position", "the key is option 1 in 6 of 6"),
    ]
    same_level = [question(f"t{i}", difficulty=2) for i in range(6)]
    assert codes(balance_flags({"TRUE_FALSE": 6}, same_level))[-1] == "difficulty_flat"


def test_failed_and_uncovered_windows() -> None:
    unit = units()[0]
    unit.windows = [
        WindowRecord(
            index=1,
            pages=["u:1", "u:3"],
            chars=9,
            requested={"TRUE_FALSE": 2},
            received=0,
            error="RATE_LIMITED",
        ),
        WindowRecord(
            index=2, pages=["u:4"], chars=9, requested={"TRUE_FALSE": 1}, received=0, error=None
        ),
    ]
    flags = window_flags(unit)
    assert [(f.code, f.severity) for f in flags] == [
        ("window_failed", "error"),
        ("window_uncovered", "warn"),
    ]
    assert "u:1 to u:3" in flags[0].detail


def test_bank_files_are_read_and_bad_ones_rejected(tmp_path: Path) -> None:
    (tmp_path / "kvizovi").mkdir()
    (tmp_path / "kvizovi" / "01.json").write_text(
        json.dumps({"version": "quiz-import-v1", "questions": [{"stem": "Što je leksem?"}]}),
        encoding="utf-8",
    )
    text = render_template("PPJ", "PPJ", ["*.pdf"])
    config = StudioConfig.model_validate(
        tomllib.loads(text.replace("existing = []", "existing = ['kvizovi/*.json']"))
    )
    assert load_bank(tmp_path, config) == [("01.json #1", "sto je leksem")]

    (tmp_path / "kvizovi" / "02.json").write_text("[]", encoding="utf-8")
    with pytest.raises(StudioError, match="not a quiz import file"):
        load_bank(tmp_path, config)


@pytest.mark.parametrize(
    ("explanation", "flagged"),
    [
        ("Opcija B je broj ključeva supstitucijske šifre.", True),
        ("Odgovor (c) opisuje DES, a ne AES.", True),
        ("Prvi odgovor miješa pojmove.", True),
        ("Cezarova šifra ima 25 ključeva, a supstitucijska mnogo više.", False),
        ("Odgovor a i b se razlikuju", True),
    ],
)
def test_explanations_that_name_an_option_letter(explanation: str, flagged: bool) -> None:
    from studio.checks import OPTION_LETTER

    assert bool(OPTION_LETTER.search(fold(explanation))) is flagged
