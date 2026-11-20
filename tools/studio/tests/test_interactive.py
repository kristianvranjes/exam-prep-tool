"""TABLE, CIRCUIT and WAVEFORM in the studio: generation, key checks and verification."""

import json
from typing import Any

import pytest

from studio.appschema import blanks_match, content_error
from studio.boolean import ParseError, parse, split
from studio.generate import GenInteractiveQuestion, Source, StoredQuestion, to_content
from studio.interactive import key_flags
from studio.prompts import QUESTIONS_SYSTEM, questions_system
from studio.verify import VerifyInteractiveAnswer, agreement, blind

Y = ["0", "0", "0", "1", "0", "1", "0", "0"]
TABLE: dict[str, Any] = {
    "type": "TABLE",
    "stem": "Popunite stupac Y za zadanu funkciju.",
    "expr": "Y = (A ⊕ B) · C",
    "table": {
        "columns": ["A", "B", "C", "Y"],
        "values": ["0", "1"],
        "rows": [[*f"{n:03b}", {"answer": Y[n]}] for n in range(8)],
    },
}
CIRCUIT: dict[str, Any] = {
    "type": "CIRCUIT",
    "stem": "Dovršite sklop tako da vrijedi Y = AB + C'.",
    "expr": "Y = AB + C'",
    "circuit": {
        "inputs": ["A", "B", "C"],
        "gates": [
            {"id": "G1", "type": "AND", "inputs": ["A", "B"]},
            {"id": "G2", "type": "NOT", "inputs": ["C"]},
            {"id": "G3", "inputs": ["G1", "G2"], "choices": ["AND", "OR", "XOR"], "answer": "OR"},
        ],
        "outputs": [{"name": "Y", "source": "G3"}],
    },
}
WAVEFORM: dict[str, Any] = {
    "type": "WAVEFORM",
    "stem": "Docrtajte izlaz Q.",
    "waveform": {
        "segments": 4,
        "signals": [{"name": "CLK", "values": "0101"}, {"name": "Q", "answer": "0011"}],
    },
}


@pytest.mark.parametrize(
    ("text", "names", "table"),
    [
        ("(A ⊕ B) · C", {"A", "B", "C"}, [0, 0, 0, 1, 0, 1, 0, 0]),
        ("AB + C'", {"A", "B", "C"}, [1, 0, 1, 0, 1, 0, 1, 1]),
        ("¬A + B·C", {"A", "B", "C"}, [1, 1, 1, 1, 0, 0, 0, 1]),
        ("(A+B)'C", {"A", "B", "C"}, [0, 1, 0, 0, 0, 0, 0, 0]),
        ("NOT A & 1", {"A"}, None),
    ],
)
def test_boolean_expressions_in_slide_notation(text, names, table):
    f, found = parse(text)
    assert found == names
    if table is not None:
        rows = [f({"A": n >> 2 & 1, "B": n >> 1 & 1, "C": n & 1}) for n in range(8)]
        assert rows == table


def test_unreadable_expressions_are_refused_and_left_sides_split():
    for bad in ("Σm(0, 2, 5)", "A +", "(A"):
        with pytest.raises(ParseError):
            parse(bad)
    assert split("f(A, B, C) = AB") == ("f", "AB")
    assert split("AB + C") == (None, "AB + C")


def test_a_truth_table_must_agree_with_its_function():
    assert content_error(TABLE) is None
    assert key_flags(TABLE) == []
    wrong = json.loads(json.dumps(TABLE))
    wrong["table"]["rows"][2][3] = {"answer": "1"}
    [(code, severity, detail)] = key_flags(wrong)
    assert (code, severity) == ("key_contradicts_expr", "warn") and "cells 3" in detail
    unreadable = TABLE | {"expr": "Y = Σm(3, 5)"}
    assert [f[0] for f in key_flags(unreadable)] == ["expr_not_checked"]
    other_names = TABLE | {"expr": "Y = P + Q"}
    assert [f[0] for f in key_flags(other_names)] == ["expr_not_checked"]
    assert key_flags(TABLE | {"expr": None}) == []


def test_a_karnaugh_map_is_read_from_its_corner_and_gray_code_headers():
    kmap = {
        "type": "TABLE",
        "stem": "Popunite K-tablicu.",
        "expr": "F = A'B + AC",
        "table": {
            "columns": ["00", "01", "11", "10"],
            "row_labels": ["0", "1"],
            "corner": "A\\BC",
            "values": ["0", "1", "X"],
            "rows": [
                ["0", "0", {"answer": "1"}, {"answer": "1"}],
                ["0", {"answer": "1"}, "1", {"answer": "X"}],
            ],
        },
    }
    assert content_error(kmap) is None
    assert key_flags(kmap) == []
    kmap["table"]["rows"][1][1] = {"answer": "0"}
    assert key_flags(kmap)[0][0] == "key_contradicts_expr"


def test_a_circuit_key_must_compute_its_function():
    assert key_flags(CIRCUIT) == []
    wrong = json.loads(json.dumps(CIRCUIT))
    wrong["circuit"]["gates"][2]["answer"] = "XOR"
    [(code, _, detail)] = key_flags(wrong)
    assert code == "key_contradicts_expr" and "inputs 110" in detail
    assert key_flags(WAVEFORM) == []


def generated(kind: str, spec: str | None, expr: str | None = None) -> GenInteractiveQuestion:
    return GenInteractiveQuestion(
        type=kind,  # type: ignore[arg-type]
        stem="Pitanje",
        options=[],
        correct_answer=None,
        reference_answer=None,
        correct_value=None,
        absolute_tolerance=None,
        relative_tolerance=None,
        unit=None,
        explanation="Zato.",
        difficulty=2,
        page="P1",
        quote="citat",
        spec=spec,
        expr=expr,
    )


def test_generated_specs_are_parsed_into_the_import_shape():
    content = to_content(generated("TABLE", json.dumps(TABLE["table"]), " Y = (A ⊕ B) · C "))
    assert content["table"] == TABLE["table"] and content["expr"] == "Y = (A ⊕ B) · C"
    assert content_error(content) is None
    broken = to_content(generated("WAVEFORM", "{segments: 4"))
    assert broken["waveform"] == "{segments: 4" and content_error(broken) is not None


def test_only_windows_with_interactive_types_get_their_rules():
    assert questions_system({"MULTIPLE_CHOICE": 4, "TRUE_FALSE": 2}) == QUESTIONS_SYSTEM
    prompt = questions_system({"MULTIPLE_CHOICE": 4, "TABLE": 1})
    assert prompt.startswith(QUESTIONS_SYSTEM) and "- TABLE:" in prompt
    assert "- CIRCUIT:" not in prompt and "- WAVEFORM:" not in prompt


def stored(content: dict[str, Any]) -> StoredQuestion:
    return StoredQuestion(
        id="u01-w01-01",
        window=1,
        content=content,
        source=Source(pdf="deck", page=1, quote="citat"),
        schema_error=content_error(content),
    )


def answer(values: list[str] | None) -> VerifyInteractiveAnswer:
    return VerifyInteractiveAnswer(
        question="q1",
        answerable=True,
        choice=[],
        truth=None,
        value=None,
        reference_supported=None,
        confidence="high",
        problem=None,
        reason="Iz tablice istinitosti.",
        values=values,
    )


def test_the_verifier_sees_the_layout_without_the_key_and_is_graded_like_the_app():
    shown = blind(stored(TABLE), "q1", "P1")
    assert shown["layout"]["rows"][3] == ["0", "1", "1", None] and shown["expr"] == TABLE["expr"]
    assert "answer" not in json.dumps(shown)
    assert agreement(stored(TABLE), answer(Y)) is True
    assert agreement(stored(TABLE), answer(["1", *Y[1:]])) is False
    assert agreement(stored(TABLE), answer(None)) is None
    assert agreement(stored(CIRCUIT), answer(["or"])) is True
    assert agreement(stored(CIRCUIT), answer(["XOR"])) is False
    assert agreement(stored(WAVEFORM), answer(list("0011"))) is True
    assert blanks_match(["0", "0", "1"], WAVEFORM) is False
