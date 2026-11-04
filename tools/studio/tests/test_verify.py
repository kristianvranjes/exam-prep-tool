import json
import shutil
import tomllib
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import pytest
from pdfgen import make_pdf
from test_generate import DECK, FakeGenerator, client, doc, run

import studio.cli
from studio.checks import check_course
from studio.cli import main
from studio.config import Questions, StudioConfig, render_template
from studio.course import CourseFile, SourceRange, Unit
from studio.generate import Source, StoredQuestion, UnitQuestions, load_questions
from studio.verify import (
    LETTERS,
    UnitVerify,
    Verdict,
    VerifyAnswer,
    VerifyResult,
    agreement,
    blind,
    calibration,
    plan_batches,
    verify_unit,
)

Policy = Callable[[dict[str, Any], StoredQuestion], dict[str, Any]]


def honest(shown: dict[str, Any], question: StoredQuestion) -> dict[str, Any]:
    """Answers with the stored key, as a verifier that agrees with everything would."""
    content = question.content
    answer: dict[str, Any] = {
        "question": shown["question"],
        "answerable": True,
        "choice": [],
        "truth": None,
        "value": None,
        "reference_supported": None,
        "confidence": "high",
        "problem": None,
        "reason": "Pise na stranici.",
    }
    if "options" in content:
        answer["choice"] = [LETTERS[i] for i, o in enumerate(content["options"]) if o["is_correct"]]
    elif content["type"] == "TRUE_FALSE":
        answer["truth"] = content["correct_answer"]
    elif content["type"] == "NUMERIC":
        answer["value"] = content["correct_value"]
    else:
        answer["reference_supported"] = True
    return answer


class FakeVerifier:
    def __init__(
        self,
        questions: UnitQuestions,
        policy: Policy = honest,
        fail_calls: set[int] | None = None,
    ) -> None:
        self.by_stem = {q.content["stem"]: q for q in questions.questions}
        self.policy = policy
        self.fail_calls = fail_calls or set()
        self.requests: list[dict[str, Any]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        payload = json.loads(json.loads(request.content)["messages"][1]["content"])
        self.requests.append(payload)
        if len(self.requests) in self.fail_calls:
            return httpx.Response(429, json={"error": {"message": "slow down"}})
        answers = [self.policy(s, self.by_stem[s["stem"]]) for s in payload["questions"]]
        content = json.dumps({"answers": [a for a in answers if a]}, ensure_ascii=False)
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


def generated_unit(tmp_path: Path) -> UnitQuestions:
    return run(FakeGenerator(), tmp_path).questions


def verify(handler: FakeVerifier, tmp_path: Path, questions: UnitQuestions) -> VerifyResult:
    return verify_unit(
        questions=questions,
        docs={"u": doc(10)},
        client=client(handler, tmp_path),
        studio_dir=tmp_path,
        batch_size=6,
    )


def test_the_verifier_never_sees_an_objective_key(tmp_path: Path) -> None:
    for question in generated_unit(tmp_path).questions:
        shown = blind(question, "q1", "P1")
        text = json.dumps(shown)
        assert "is_correct" not in text and "correct_answer" not in text
        if question.content["type"] == "SHORT_ANSWER":
            assert shown["reference_answer"] == question.content["reference_answer"]
        else:
            assert "reference_answer" not in shown


def test_batches_stay_within_a_window_and_skip_unusable_questions(tmp_path: Path) -> None:
    questions = generated_unit(tmp_path)
    questions.questions[0].schema_error = "invalid"
    questions.questions[1].source = None
    batches = plan_batches(questions, 6)
    assert all(len(b) <= 6 and len({q.window for q in b}) == 1 for b in batches)
    assert sum(len(b) for b in batches) == 18


def numeric(**content: Any) -> StoredQuestion:
    body = {"type": "NUMERIC", "stem": "g?", "correct_value": "9.81"} | content
    source = Source(pdf="u", page=1, quote="q")
    return StoredQuestion(id="n", window=1, content=body, source=source, schema_error=None)


def answer(**fields: Any) -> VerifyAnswer:
    base = {
        "question": "q1",
        "answerable": True,
        "choice": [],
        "truth": None,
        "value": None,
        "reference_supported": None,
        "confidence": "high",
        "problem": None,
        "reason": "r",
    }
    return VerifyAnswer.model_validate(base | fields)


def test_numeric_answers_use_the_application_tolerance() -> None:
    tolerant = numeric(relative_tolerance="0.01")
    assert agreement(tolerant, answer(value="9,8")) is True
    assert agreement(tolerant, answer(value="10")) is False
    assert agreement(numeric(), answer(value="9.81")) is True
    assert agreement(numeric(), answer(value="devet")) is False
    assert agreement(numeric(), answer(answerable=False)) is None


def course_for(config: StudioConfig) -> CourseFile:
    return CourseFile(
        version="studio-course-v1",
        course=config.course,
        units=[Unit(id="01", title="K", sources=[SourceRange(pdf="u", pages="1-10")])],
    )


def test_disagreements_become_review_flags(tmp_path: Path) -> None:
    questions = generated_unit(tmp_path)
    mc = next(q for q in questions.questions if q.content["type"] == "MULTIPLE_CHOICE")
    tf = next(q for q in questions.questions if q.content["type"] == "TRUE_FALSE")
    sa = next(q for q in questions.questions if q.content["type"] == "SHORT_ANSWER")

    def policy(shown: dict[str, Any], question: StoredQuestion) -> dict[str, Any]:
        reply = honest(shown, question)
        if question.id == mc.id:
            key = reply["choice"][0]
            reply["choice"] = [next(x for x in "ABCD" if x != key)]
            reply["reason"] = "Stranica kaze drugo."
        if question.id == tf.id:
            reply |= {"answerable": False, "truth": None, "reason": "Nema podatka."}
        if question.id == sa.id:
            reply["problem"] = "Pitanje je dvosmisleno."
        return reply

    result = verify(FakeVerifier(questions, policy), tmp_path, questions)
    assert result.state == "verified" and len(result.verify.verdicts) == 20
    by_id = {v.id: v for v in result.verify.verdicts}
    assert by_id[mc.id].agrees is False and by_id[tf.id].agrees is None
    assert by_id[sa.id].agrees is True and by_id[sa.id].problem == "Pitanje je dvosmisleno."

    config = StudioConfig.model_validate(tomllib.loads(render_template("SRS", "SRS", ["*.pdf"])))
    [checked] = check_course(config, course_for(config), {"u": doc(10)}, tmp_path)
    flags = {q.id: {f.code: f.detail for f in q.flags} for q in checked.questions}
    assert "key:" in flags[mc.id]["verifier_disagrees"]
    assert "Stranica kaze drugo." in flags[mc.id]["verifier_disagrees"]
    assert "verifier_unanswerable" in flags[tf.id]
    assert flags[sa.id]["verifier_problem"] == "Pitanje je dvosmisleno."
    assert checked.summary["verified"] == 20 and checked.summary["verifier_agrees"] == 18


def test_unchanged_units_are_not_reverified_and_failures_are_retried(tmp_path: Path) -> None:
    questions = generated_unit(tmp_path)
    first = verify(FakeVerifier(questions, fail_calls={2}), tmp_path, questions)
    assert first.state == "partial"
    assert [b.error for b in first.verify.batches if b.error] == ["RATE_LIMITED"]

    retry = FakeVerifier(questions)
    second = verify(retry, tmp_path, questions)
    assert second.state == "verified" and len(retry.requests) == 1
    assert len(second.verify.verdicts) == 20

    idle = FakeVerifier(questions)
    assert verify(idle, tmp_path, questions).state == "unchanged" and idle.requests == []

    run(FakeGenerator(), tmp_path, blueprint=Questions(types={"TRUE_FALSE": 3}))
    changed = load_questions(tmp_path, "01")
    assert changed is not None
    again = FakeVerifier(changed)
    assert verify(again, tmp_path, changed).state == "verified" and again.requests


def test_a_batch_with_missing_answers_is_retried(tmp_path: Path) -> None:
    questions = generated_unit(tmp_path)
    skip = questions.questions[0].id

    def forgetful(shown: dict[str, Any], question: StoredQuestion) -> dict[str, Any]:
        return {} if question.id == skip else honest(shown, question)

    first = verify(FakeVerifier(questions, forgetful), tmp_path, questions)
    assert first.state == "partial"
    assert [b.error for b in first.verify.batches if b.error] == ["MISSING_ANSWERS: 1"]
    retry = FakeVerifier(questions)
    assert verify(retry, tmp_path, questions).state == "verified" and len(retry.requests) == 1


def true_false(qid: str) -> StoredQuestion:
    return StoredQuestion(
        id=qid,
        window=1,
        content={"type": "TRUE_FALSE", "stem": qid, "correct_answer": True},
        source=Source(pdf="u", page=1, quote="q"),
        schema_error=None,
    )


def said(qid: str, truth: bool | None, problem: str | None = None) -> Verdict:
    return Verdict(
        id=qid,
        answerable=truth is not None,
        choice=[],
        truth=truth,
        value=None,
        reference_supported=None,
        agrees=None if truth is None else truth is True,
        confidence="high",
        problem=problem,
        reason="r",
    )


def test_calibration_counts_seeded_wrong_keys_the_blind_answers_would_catch() -> None:
    questions = UnitQuestions(
        version="studio-questions-v1",
        unit="01",
        title="T",
        prompt_version="p",
        model="m/m",
        input_hash="h",
        generated_at="t",
        windows=[],
        questions=[true_false(q) for q in "abcd"],
    )
    verify_file = UnitVerify(
        version="studio-verify-v1",
        unit="01",
        questions_hash="h",
        model="m/m",
        prompt_version="v",
        verified_at="t",
        batches=[],
        verdicts=[
            said("a", True),  # agrees, so a flipped key (false) would be caught
            said("b", False),  # disagrees, so a flipped key would pass unnoticed
            said("c", None),  # not answerable: always flagged
            said("d", False, "contradicts the page"),  # a named problem is flagged
        ],
    )
    result = calibration(questions, verify_file)
    assert (result.objective, result.agreed, result.caught) == (4, 1, 3)


def test_cli_verify_check_calibrate_and_status(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    pages = [[title, line, f"Primjer: {title.lower()} u praksi."] for title, line in DECK]
    (tmp_path / "pdf").mkdir()
    (tmp_path / "pdf" / "01 Kripto.pdf").write_bytes(make_pdf(pages))
    studio_dir = tmp_path / "studio"
    args = ["--name", "SRS", "--code", "SRS", "--pdfs", "../pdf/*.pdf"]
    assert main(["init", str(studio_dir), *args]) == 0
    assert main(["ingest", str(studio_dir)]) == 0
    shutil.copy(studio_dir / "course.proposed.yaml", studio_dir / "course.yaml")
    assert main(["verify", str(studio_dir)]) == 2  # nothing generated yet

    generator = FakeGenerator()
    monkeypatch.setattr(studio.cli, "stage_client", lambda *a: client(generator, tmp_path))
    assert main(["generate", str(studio_dir)]) == 0
    questions = load_questions(studio_dir, "01")
    assert questions is not None
    capsys.readouterr()

    assert main(["verify", str(studio_dir), "--dry-run"]) == 0
    assert "nothing was sent" in capsys.readouterr().out
    verifier = FakeVerifier(questions)
    monkeypatch.setattr(studio.cli, "stage_client", lambda *a: client(verifier, tmp_path))
    assert main(["verify", str(studio_dir)]) == 0
    assert "10 verified, 10 agree, 0 disagree" in capsys.readouterr().out

    assert main(["status", str(studio_dir)]) == 0
    assert "verifier agrees on 10 of 10, not checked" in capsys.readouterr().out
    assert main(["check", str(studio_dir)]) == 0
    assert main(["status", str(studio_dir)]) == 0
    assert "verifier agrees on 10 of 10, 0 errors" in capsys.readouterr().out

    assert main(["calibrate", str(studio_dir)]) == 0
    out = capsys.readouterr().out
    assert "agrees with 9 of 9 keys (100%)" in out
    assert "would catch 9 of 9 seeded wrong keys" in out
