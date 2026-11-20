"""TABLE, CIRCUIT and WAVEFORM questions (#161, #164; migration 0038).

Behaviour under test: spec validation (schemas.interactive), blank answers (schemas.quiz),
grading (services.grading.grade_blanks), and the bank, session and import flow.
"""

import os
from decimal import Decimal

import pytest
from alembic.config import Config
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import text
from test_materials import clients as clients
from test_numeric_multiselect_database import approve
from test_practice_database import bank as bank

from alembic import command
from app.database import engine
from app.schemas.question import OwnerQuestion, QuizImport, content_adapter, stem_key
from app.schemas.quiz import AnswerPayload
from app.services.grading import BLANKS_VERSION, CIRCUIT_VERSION, grade
from app.services.interactive import blank_key, public_spec, truth_table

db_only = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")
answers: TypeAdapter[AnswerPayload] = TypeAdapter(AnswerPayload)

# Y = (A xor B) and C, counting from 000 to 111.
Y = ["0", "0", "0", "1", "0", "1", "0", "0"]
TABLE = {
    "type": "TABLE",
    "stem": "Popunite stupac Y za zadanu funkciju.",
    "expr": "Y = (A ⊕ B) · C",
    "table": {
        "columns": ["A", "B", "C", "Y"],
        "values": ["0", "1"],
        "rows": [[*f"{n:03b}", {"answer": Y[n]}] for n in range(8)],
    },
}
CIRCUIT = {
    "type": "CIRCUIT",
    "stem": "Dovršite sklop tako da vrijedi Y = AB + C'.",
    "circuit": {
        "inputs": ["A", "B", "C"],
        "gates": [
            {"id": "G1", "type": "AND", "inputs": ["A", "B"]},
            {"id": "G2", "type": "NOT", "inputs": ["C"]},
            {
                "id": "G3",
                "inputs": ["G1", "G2"],
                "choices": ["AND", "OR", "XOR", "NAND", "NOR"],
                "answer": "OR",
            },
        ],
        "outputs": [{"name": "Y", "source": "G3"}],
    },
}
WAVEFORM = {
    "type": "WAVEFORM",
    "stem": "D bistabil okida se na rastući brid takta. Početno je Q = 0. Docrtajte izlaz Q.",
    "waveform": {
        "segments": 8,
        "signals": [
            {"name": "CLK", "values": "01010101"},
            {"name": "D", "values": "11001100"},
            {"name": "Q", "answer": "01100110"},
        ],
    },
}


def snapshot(content: dict) -> OwnerQuestion:
    question = content_adapter.validate_python(content)
    spec = getattr(question, content["type"].lower()).model_dump(mode="json", exclude_none=True)
    return OwnerQuestion.model_validate(
        {
            "id": "00000000-0000-0000-0000-000000000001",
            "course_id": "00000000-0000-0000-0000-000000000002",
            "created_by_user_id": "00000000-0000-0000-0000-000000000003",
            "ai_job_id": None,
            "status": "APPROVED",
            "source": "USER",
            "correct_boolean": None,
            "reference_answer": None,
            "reviewed_by_user_id": None,
            "reviewed_at": None,
            "rejection_reason": None,
            "created_at": "2026-11-20T10:00:00Z",
            "updated_at": "2026-11-20T10:00:00Z",
            "type": content["type"],
            "stem": question.stem,
            "explanation": None,
            "difficulty": None,
            "spec": spec,
        }
    )


def filled(type_: str, values: list) -> AnswerPayload:
    return answers.validate_python({"type": type_, "values": values})


def with_spec(content: dict, **changes) -> dict:
    key = content["type"].lower()
    return content | {key: content[key] | changes}


def test_table_specs_need_a_regular_grid_with_blanks_from_the_allowed_values():
    content = content_adapter.validate_python(TABLE)
    assert content.table.rows[3][3].answer == "1"
    rows = TABLE["table"]["rows"]
    for bad in (
        {"rows": [row[:3] for row in rows]},  # no blank
        {"rows": [rows[0][:3], *rows[1:]]},  # a short row
        {"rows": [[*row[:3], {"answer": "2"}] for row in rows]},  # not an allowed value
        {"values": ["0", "0"]},
        {"corner": "AB\\CD"},  # a corner without row labels
        {"row_labels": ["00"]},  # one label for eight rows
    ):
        with pytest.raises(ValidationError):
            content_adapter.validate_python(with_spec(TABLE, **bad))
    # A Karnaugh map: row and column headers, a corner, X for a don't-care.
    kmap = with_spec(
        TABLE,
        columns=["00", "01", "11", "10"],
        row_labels=["0", "1"],
        corner="A\\BC",
        values=["0", "1", "X"],
        rows=[["0", {"answer": "1"}, "1", "0"], [{"answer": "x"}, "0", "1", "1"]],
    )
    assert content_adapter.validate_python(kmap).table.corner == "A\\BC"
    # Without values the student types the cell.
    typed = with_spec(TABLE, values=None, rows=[["FIFO", "1", "2", {"answer": "Stranica 3"}]])
    assert content_adapter.validate_python(typed).table.values is None


def test_circuit_specs_are_ordered_netlists_with_one_to_four_slots():
    assert content_adapter.validate_python(CIRCUIT).circuit.gates[2].answer == "OR"
    gates = CIRCUIT["circuit"]["gates"]
    for bad in (
        {"gates": gates[:2]},  # no slot
        {"gates": [gates[2], *gates[:2]]},  # reads gates listed after it
        {"gates": [*gates[:2], gates[2] | {"answer": "XNOR"}]},  # answer not a choice
        {"gates": [*gates[:2], gates[2] | {"type": "OR"}]},  # both fixed and a slot
        {"gates": [gates[0] | {"type": "NOT"}, *gates[1:]]},  # NOT with two inputs
        {"gates": [*gates[:2], gates[2] | {"choices": ["OR", "NOT"]}]},  # NOT in a 2-input slot
        {"outputs": [{"name": "Y", "source": "G9"}]},
        {"outputs": [{"name": "A", "source": "G3"}]},  # name taken by an input
        {"inputs": ["A", "B", "C", "A"]},
    ):
        with pytest.raises(ValidationError):
            content_adapter.validate_python(with_spec(CIRCUIT, **bad))


def test_waveform_specs_give_one_level_per_segment_and_draw_one_to_three_signals():
    assert content_adapter.validate_python(WAVEFORM).waveform.signals[2].answer == "01100110"
    signals = WAVEFORM["waveform"]["signals"]
    for bad in (
        {"signals": signals[:2]},  # nothing to draw
        {"signals": [*signals[:2], {"name": "Q", "answer": "0110"}]},  # too short
        {"signals": [*signals[:2], {"name": "Q", "answer": "01100112"}]},
        {"signals": [*signals, {"name": "q", "answer": "00000000"}]},  # duplicate name
        {"signals": [*signals[:2], {"name": "Q", "values": "0", "answer": "01100110"}]},
        {"segments": 1},
    ):
        with pytest.raises(ValidationError):
            content_adapter.validate_python(with_spec(WAVEFORM, **bad))


def test_public_specs_hide_every_key():
    table = public_spec("TABLE", snapshot(TABLE).spec)
    assert table is not None and table["rows"][3] == ["0", "1", "1", None]
    circuit = public_spec("CIRCUIT", snapshot(CIRCUIT).spec)
    assert circuit is not None and "answer" not in str(circuit)
    assert circuit["gates"][2]["choices"] == ["AND", "OR", "XOR", "NAND", "NOR"]
    waveform = public_spec("WAVEFORM", snapshot(WAVEFORM).spec)
    assert waveform is not None and waveform["signals"][2] == {"name": "Q", "values": None}
    assert "01100110" not in str(waveform)
    assert public_spec("MATCH", None) is None


def test_blank_answers_fill_something():
    assert filled("TABLE", ["1", None]).values == ["1", None]
    for bad in ([], [None, None], ["x" * 41], ["1"] * 97):
        with pytest.raises(ValidationError):
            filled("TABLE", bad)


def test_tables_and_waveforms_earn_the_share_of_blanks_right():
    key = snapshot(TABLE)
    result = grade(key, filled("TABLE", Y))
    assert (result.status, result.version, result.fraction) == ("CORRECT", BLANKS_VERSION, 1)
    six = grade(key, filled("TABLE", ["1", "1", *Y[2:]]))
    assert (six.status, six.fraction) == ("INCORRECT", Decimal("0.75"))
    # Blanks left open count as wrong; an eighth rounds down to whole percent.
    one = grade(key, filled("TABLE", ["0", None, None, None, None, None, None, None]))
    assert one.fraction == Decimal("0.12")
    with pytest.raises(ValueError):
        grade(key, filled("TABLE", Y[:7]))  # one value short
    with pytest.raises(ValueError):
        grade(key, filled("TABLE", ["2", *Y[1:]]))  # not an allowed value
    wave = snapshot(WAVEFORM)
    assert grade(wave, filled("WAVEFORM", list("01100110"))).status == "CORRECT"
    half = grade(wave, filled("WAVEFORM", list("01101001")))
    assert (half.status, half.fraction) == ("INCORRECT", Decimal("0.5"))


def test_typed_table_cells_compare_without_case_or_spacing():
    key = snapshot(with_spec(TABLE, values=None, rows=[["a", "b", "c", {"answer": "Stranica 3"}]]))
    assert grade(key, filled("TABLE", ["  stranica   3 "])).status == "CORRECT"


def test_a_circuit_is_right_when_it_computes_the_key_with_any_gates():
    key = snapshot(CIRCUIT)
    right = grade(key, filled("CIRCUIT", ["or"]))
    assert (right.status, right.version, right.fraction) == ("CORRECT", CIRCUIT_VERSION, 1)
    assert grade(key, filled("CIRCUIT", ["XOR"])).fraction == 0
    # Both gates of a slot fed twice by A pass A through, so either is right.
    twice = with_spec(
        CIRCUIT,
        inputs=["A"],
        gates=[{"id": "S", "inputs": ["A", "A"], "choices": ["AND", "OR", "XOR"], "answer": "AND"}],
        outputs=[{"name": "Y", "source": "S"}],
    )
    assert grade(snapshot(twice), filled("CIRCUIT", ["OR"])).status == "CORRECT"
    assert grade(snapshot(twice), filled("CIRCUIT", ["XOR"])).status == "INCORRECT"
    spec = snapshot(CIRCUIT).spec
    assert spec is not None
    assert [row[0] for row in truth_table(spec, blank_key("CIRCUIT", spec))] == [
        1,
        0,
        1,
        0,
        1,
        0,
        1,
        1,
    ]


def test_import_v2_accepts_the_new_types_and_a_shared_stem_with_another_expression():
    other = TABLE | {"expr": "Y = A + B · C"}
    document = {"questions": [TABLE, other, CIRCUIT, WAVEFORM]}
    accepted = QuizImport.model_validate({"version": "quiz-import-v2", **document})
    assert [q.type for q in accepted.questions] == ["TABLE", "TABLE", "CIRCUIT", "WAVEFORM"]
    assert stem_key(accepted.questions[0]) != stem_key(accepted.questions[1])
    with pytest.raises(ValidationError, match="quiz-import-v2"):
        QuizImport.model_validate({"version": "quiz-import-v1", **document})
    with pytest.raises(ValidationError, match="Duplicate"):
        QuizImport.model_validate({"version": "quiz-import-v2", "questions": [TABLE, TABLE]})


def session(member, course, type_):
    response = member.post(
        f"/courses/{course}/attempts", json={"count": 1, "question_types": [type_]}
    )
    assert response.status_code == 201, response.text
    return response.json()


def answer_and_submit(member, course, attempt, type_, values):
    path = f"/courses/{course}/attempts/{attempt['id']}"
    question = attempt["questions"][0]
    saved = member.patch(f"{path}/answers/{question['id']}", json={"type": type_, "values": values})
    assert saved.status_code == 200, saved.text
    submitted = member.post(path + "/submit")
    assert submitted.status_code == 200, submitted.text
    return submitted.json()["questions"][0]


@db_only
def test_bank_keeps_the_spec_for_authors_and_shows_students_the_layout_only(bank):
    owner, member, _, course, _ = bank
    created = approve(owner, course, TABLE)
    assert created["spec"]["rows"][3][3] == {"answer": "1"}
    seen = member.get(f"/questions/{created['id']}").json()
    assert seen["spec"]["rows"][3] == ["0", "1", "1", None]
    assert "answer" not in str(seen["spec"])

    # The same stem with another expression is another question; editing swaps the spec.
    drafted = owner.post(
        f"/courses/{course}/questions", json=TABLE | {"expr": "Y = A · B · C"}
    ).json()
    edited = owner.patch(
        f"/questions/{drafted['id']}",
        json={"table": TABLE["table"] | {"rows": [["1", "1", "1", {"answer": "1"}]]}},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["spec"]["rows"] == [["1", "1", "1", {"answer": "1"}]]
    broken = owner.patch(f"/questions/{drafted['id']}", json={"table": {"columns": ["A"]}})
    assert broken.status_code == 422


@db_only
def test_sessions_hide_keys_grade_blanks_and_reveal_the_key_after(bank):
    owner, member, _, course, _ = bank
    for content in (TABLE, CIRCUIT, WAVEFORM):
        approve(owner, course, content)

    table = session(member, course, "TABLE")
    shown = table["questions"][0]
    assert shown["spec"]["rows"][0] == ["0", "0", "0", None]
    assert "answer" not in str(shown["spec"]) and shown["feedback"] is None
    result = answer_and_submit(member, course, table, "TABLE", ["1", "1", *Y[2:]])
    assert (result["grading_status"], result["score_fraction"]) == ("INCORRECT", 0.75)
    assert result["correct_values"] == Y

    circuit = session(member, course, "CIRCUIT")
    assert "answer" not in str(circuit["questions"][0]["spec"])
    right = answer_and_submit(member, course, circuit, "CIRCUIT", ["OR"])
    assert (right["grading_status"], right["correct_values"]) == ("CORRECT", ["OR"])

    wave = session(member, course, "WAVEFORM")
    assert wave["questions"][0]["spec"]["signals"][2] == {"name": "Q", "values": None}
    drawn = answer_and_submit(member, course, wave, "WAVEFORM", list("0110011") + [None])
    assert (drawn["grading_status"], drawn["score_fraction"]) == ("INCORRECT", 0.87)

    # Answers must fit the blanks: count and allowed values.
    refused = session(member, course, "TABLE")
    path = f"/courses/{course}/attempts/{refused['id']}/answers/{refused['questions'][0]['id']}"
    assert member.patch(path, json={"type": "TABLE", "values": ["1"]}).status_code == 422
    assert member.patch(path, json={"type": "TABLE", "values": ["2"] * 8}).status_code == 422
    assert member.patch(path, json={"type": "CIRCUIT", "values": ["OR"]}).status_code == 422


@db_only
def test_imports_create_drafts_and_default_practice_counts_the_new_types(bank):
    owner, member, _, course, _ = bank
    document = {"version": "quiz-import-v2", "questions": [TABLE, CIRCUIT, WAVEFORM]}
    checked = owner.post(f"/courses/{course}/questions/import/check", json=document)
    assert checked.status_code == 200, checked.text
    imported = owner.post(f"/courses/{course}/questions/import", json=document)
    assert imported.status_code == 201, imported.text
    assert [q["type"] for q in imported.json()] == ["TABLE", "CIRCUIT", "WAVEFORM"]
    approve(owner, course, TABLE | {"expr": "Y = A + B"})
    counts = member.get(f"/courses/{course}/practice-availability").json()["by_type"]
    assert {entry["type"]: entry["count"] for entry in counts}["TABLE"] == 1


@db_only
def test_0038_roundtrip_refuses_while_interactive_questions_exist(bank):
    owner, member, _, course, _ = bank
    approve(owner, course, CIRCUIT)
    config = Config("alembic.ini")
    try:
        with pytest.raises(RuntimeError, match="interactive questions"):
            command.downgrade(config, "0037")
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM questions WHERE type IN ('TABLE','CIRCUIT','WAVEFORM')"))
        for _ in range(2):
            command.downgrade(config, "0037")
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0037"
                columns = set(
                    conn.execute(
                        text(
                            "SELECT column_name FROM information_schema.columns WHERE"
                            " table_schema = current_schema() AND table_name = 'questions'"
                        )
                    ).scalars()
                )
            assert "spec" not in columns
            command.upgrade(config, "head")
    finally:
        command.upgrade(config, "head")
