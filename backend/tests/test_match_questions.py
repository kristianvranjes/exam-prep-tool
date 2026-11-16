"""MATCH questions, and the optional hint and expression of any question (0033).

Behaviour under test: content validation (schemas.question), match answers (schemas.quiz),
grading (services.grading.grade_match) and the session and bank flow of a matching question.
"""

import os

import pytest
from alembic.config import Config
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import text
from test_materials import clients as clients
from test_numeric_multiselect_database import approve
from test_practice_database import bank as bank

from alembic import command
from app.database import engine
from app.schemas.question import OwnerQuestion, QuizImport, content_adapter
from app.schemas.quiz import AnswerPayload
from app.services.grading import MATCH_VERSION, grade

db_only = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")

answers: TypeAdapter[AnswerPayload] = TypeAdapter(AnswerPayload)
PAIRS = [
    {"left": "AND", "right": "Both inputs 1"},
    {"left": "OR", "right": "At least one input 1"},
    {"left": "XOR", "right": "Inputs differ"},
]
MATCH = {"type": "MATCH", "stem": "Connect the gates", "pairs": PAIRS}


def snapshot(right_order: list[int]) -> OwnerQuestion:
    question = content_adapter.validate_python(MATCH)
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
            "created_at": "2026-10-21T10:00:00Z",
            "updated_at": "2026-10-21T10:00:00Z",
            "type": "MATCH",
            "stem": question.stem,
            "explanation": None,
            "difficulty": None,
            "options": [
                {"position": i, "text": p.left, "is_correct": True, "match_text": p.right}
                for i, p in enumerate(question.pairs)
            ],
            "right_order": right_order,
        }
    )


def matched(matches: list) -> AnswerPayload:
    return answers.validate_python({"type": "MATCH", "matches": matches})


def test_match_content_needs_two_to_six_distinct_pairs():
    assert content_adapter.validate_python(MATCH).pairs[2].left == "XOR"
    seven = [{"left": f"L{i}", "right": f"R{i}"} for i in range(7)]
    for bad in (
        PAIRS[:1],
        seven,
        [PAIRS[0], {"left": " and ", "right": "Other"}],
        [PAIRS[0], {"left": "Other", "right": "BOTH  inputs 1"}],
    ):
        with pytest.raises(ValidationError):
            content_adapter.validate_python(MATCH | {"pairs": bad})


def test_hint_and_expression_are_optional_bounded_and_trimmed():
    content = content_adapter.validate_python(
        MATCH | {"hint": "  Think of truth tables ", "expr": " A·B + C "}
    )
    assert (content.hint, content.expr) == ("Think of truth tables", "A·B + C")
    assert content_adapter.validate_python(MATCH).hint is None
    for field, size in (("hint", 401), ("expr", 201)):
        with pytest.raises(ValidationError):
            content_adapter.validate_python(MATCH | {field: "x" * size})
        with pytest.raises(ValidationError):
            content_adapter.validate_python(MATCH | {field: "   "})
    classic = {"type": "TRUE_FALSE", "stem": "A and A is A", "correct_answer": True, "expr": "A·A"}
    assert content_adapter.validate_python(classic).expr == "A·A"


def test_match_answers_use_each_shown_item_once_and_match_something():
    assert matched([1, None, 0]).matches == [1, None, 0]
    for bad in ([None, None, None], [1, 1, 0], [3, 0, 1], [0], [0, 1, 2, 3, 4, 5, 6]):
        with pytest.raises(ValidationError):
            matched(bad)


def test_every_pair_right_is_correct_and_the_grade_is_binary():
    # The left items' partners are shown at slots 1, 2 and 0.
    key = snapshot([2, 0, 1])
    result = grade(key, matched([1, 2, 0]))
    assert (result.status, result.version, result.fraction) == ("CORRECT", MATCH_VERSION, 1)


def test_pairs_left_open_earn_half_and_a_wrong_pair_earns_nothing():
    key = snapshot([2, 0, 1])
    cases = (
        ([1, None, None], "INCORRECT", 0.5),  # one right, the rest open
        ([None, 2, 0], "INCORRECT", 0.5),
        ([1, 2, None], "INCORRECT", 0.5),
        ([1, 0, None], "INCORRECT", 0),  # one right, one wrong
        ([0, 1, 2], "INCORRECT", 0),  # everything matched, everything wrong
        ([2, 1, 0], "INCORRECT", 0),  # one of three right but the others wrong
        ([None, 0, None], "INCORRECT", 0),  # nothing right
    )
    for matches, status, fraction in cases:
        result = grade(key, matched(matches))
        assert (result.status, result.fraction) == (status, fraction), matches
    with pytest.raises(ValueError):
        grade(key, matched([0, 1, None, None]))  # wrong number of items
    with pytest.raises(ValueError):
        grade(snapshot([]), matched([0, 1, 2]))  # a snapshot without an order cannot be graded


def test_import_v2_accepts_match_questions_and_v1_does_not():
    document = {"questions": [MATCH | {"hint": "Truth tables"}]}
    accepted = QuizImport.model_validate({"version": "quiz-import-v2", **document})
    assert accepted.questions[0].type == "MATCH"
    with pytest.raises(ValidationError, match="quiz-import-v2"):
        QuizImport.model_validate({"version": "quiz-import-v1", **document})


def create_match(owner, course, **extra):
    return approve(owner, course, MATCH | extra)


def session(member, course):
    response = member.post(
        f"/courses/{course}/attempts", json={"count": 1, "question_types": ["MATCH"]}
    )
    assert response.status_code == 201, response.text
    return response.json()


def correct_matches(question):
    """The shown slot of each authored right item, read from the choices the student sees."""
    slot_of = {choice["text"]: choice["position"] for choice in question["choices"]}
    return [slot_of[pair["right"]] for pair in PAIRS]


def answer_and_submit(member, course, attempt, matches):
    path = f"/courses/{course}/attempts/{attempt['id']}"
    question = attempt["questions"][0]
    saved = member.patch(
        f"{path}/answers/{question['id']}", json={"type": "MATCH", "matches": matches}
    )
    assert saved.status_code == 200, saved.text
    submitted = member.post(path + "/submit")
    assert submitted.status_code == 200, submitted.text
    return submitted.json()["questions"][0]


@db_only
def test_a_match_question_is_authored_edited_and_read_by_students_without_its_pairs(bank):
    owner, member, _, course, _ = bank
    created = create_match(owner, course, hint="Truth tables", expr="A·B")
    assert (created["hint"], created["expr"]) == ("Truth tables", "A·B")
    assert [(o["text"], o["match_text"]) for o in created["options"]] == [
        (p["left"], p["right"]) for p in PAIRS
    ]

    seen = member.get(f"/questions/{created['id']}").json()
    assert [o["text"] for o in seen["options"]] == ["AND", "OR", "XOR"]
    assert all(set(o) == {"position", "text"} for o in seen["options"])
    # The right-hand column is alphabetical, not in the order of the pairs.
    assert [c["text"] for c in seen["choices"]] == sorted(p["right"] for p in PAIRS)
    assert (seen["hint"], seen["expr"]) == ("Truth tables", "A·B")
    assert "match_text" not in str(seen)

    drafted = owner.post(
        f"/courses/{course}/questions", json=MATCH | {"stem": "Connect the latches"}
    ).json()
    edited = owner.patch(
        f"/questions/{drafted['id']}",
        json={
            "pairs": [{"left": "SR", "right": "Set and reset"}, {"left": "D", "right": "Follows"}],
            "hint": "Think of memory",
            "expr": "Q+",
        },
    )
    assert edited.status_code == 200, edited.text
    assert [(o["text"], o["match_text"]) for o in edited.json()["options"]] == [
        ("SR", "Set and reset"),
        ("D", "Follows"),
    ]
    cleared = owner.patch(f"/questions/{drafted['id']}", json={"hint": None, "expr": None})
    assert (cleared.json()["hint"], cleared.json()["expr"]) == (None, None)
    one_pair = owner.patch(f"/questions/{drafted['id']}", json={"pairs": PAIRS[:1]})
    assert one_pair.status_code == 422


@db_only
def test_a_session_shuffles_the_right_column_grades_pairs_and_reveals_the_key_after(bank):
    owner, member, _, course, _ = bank
    create_match(owner, course, hint="Truth tables", expr="A·B")
    shown = session(member, course)["questions"][0]
    assert [o["text"] for o in shown["options"]] == ["AND", "OR", "XOR"]
    assert sorted(c["text"] for c in shown["choices"]) == sorted(p["right"] for p in PAIRS)
    assert [c["text"] for c in shown["choices"]] != [p["right"] for p in PAIRS]
    assert (shown["hint"], shown["expr"]) == ("Truth tables", "A·B")
    assert shown["feedback"] is None and "match_text" not in str(shown)
    assert "correct_matches" not in str(shown)

    # Everything right: correct, full points, and the key is revealed afterwards.
    done = session(member, course)
    key = correct_matches(done["questions"][0])
    result = answer_and_submit(member, course, done, key)
    assert result["grading_status"] == "CORRECT" and result["score_fraction"] == 1
    assert result["correct_matches"] == key
    assert [o["match_text"] for o in result["options"]] == [p["right"] for p in PAIRS]

    # One pair right, the rest left open: half the points.
    partial = session(member, course)
    first_only = [correct_matches(partial["questions"][0])[0], None, None]
    half = answer_and_submit(member, course, partial, first_only)
    assert (half["grading_status"], half["score_fraction"]) == ("INCORRECT", 0.5)

    # A wrong pair: no points.
    wrong = session(member, course)
    slots = correct_matches(wrong["questions"][0])
    zero = answer_and_submit(member, course, wrong, [slots[1], slots[0], None])
    assert (zero["grading_status"], zero["score_fraction"]) == ("INCORRECT", 0)

    # An answer with the wrong number of items is refused.
    refused = session(member, course)
    path = f"/courses/{course}/attempts/{refused['id']}/answers/{refused['questions'][0]['id']}"
    assert member.patch(path, json={"type": "MATCH", "matches": [0, 1]}).status_code == 422


@db_only
def test_a_match_import_creates_a_draft_and_a_default_session_can_draw_it(bank):
    owner, member, _, course, _ = bank
    document = {"version": "quiz-import-v2", "questions": [MATCH | {"hint": "Truth tables"}]}
    imported = owner.post(f"/courses/{course}/questions/import", json=document)
    assert imported.status_code == 201, imported.text
    assert imported.json()[0]["type"] == "MATCH" and imported.json()[0]["hint"] == "Truth tables"
    v1 = document | {"version": "quiz-import-v1"}
    assert owner.post(f"/courses/{course}/questions/import", json=v1).status_code == 422

    create_match(owner, course, stem="Connect other gates")
    # Practice without a type filter counts matching questions among the types it can draw.
    counts = member.get(f"/courses/{course}/practice-availability").json()["by_type"]
    assert {entry["type"]: entry["count"] for entry in counts}["MATCH"] == 1


@db_only
def test_0033_roundtrip_refuses_while_matching_questions_exist(bank):
    owner, member, _, course, _ = bank
    create_match(owner, course)
    config = Config("alembic.ini")
    try:
        with pytest.raises(RuntimeError, match="matching questions"):
            command.downgrade(config, "0032")
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM questions WHERE type = 'MATCH'"))
        for _ in range(2):
            command.downgrade(config, "0032")
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0032"
                columns = set(
                    conn.execute(
                        text(
                            "SELECT column_name FROM information_schema.columns WHERE"
                            " table_schema = current_schema() AND table_name = 'questions'"
                        )
                    ).scalars()
                )
            assert not columns & {"hint", "expr"}
            command.upgrade(config, "head")
    finally:
        command.upgrade(config, "head")
