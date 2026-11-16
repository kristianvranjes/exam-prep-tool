import json
import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from test_materials import clients as clients

from app.main import app

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def short(stem, **extra):
    return {"type": "SHORT_ANSWER", "stem": stem, "reference_answer": "A", **extra}


def file(*questions, **top):
    return {"version": "quiz-import-v2", "questions": list(questions)} | top


def post(client, course, path, document, **params):
    body = document if isinstance(document, str) else json.dumps(document, indent=2)
    return client.post(
        f"/courses/{course}/questions/{path}",
        params=params,
        content=body,
        headers={"Content-Type": "application/json"},
    )


def unit(client, course, title):
    created = client.post(f"/courses/{course}/units", json={"title": title})
    assert created.status_code == 201, created.text
    return created.json()["id"]


def test_check_reports_every_question_without_saving(clients):
    owner, member, stranger, course = clients
    unit(owner, course, "Logika")
    document = file(
        short("Fine one", explanation="Why"),
        short("No explanation here"),
        {"type": "TRUE_FALSE", "stem": "Broken", "correct_answer": "yes"},
        short("Fine one", explanation="Why again"),
        short("Elsewhere", explanation="Why", course_unit="Nepostojeća"),
        short("Placed", explanation="Why", course_unit=" logika "),
    )
    with TestClient(app) as anonymous:
        assert post(anonymous, course, "import/check", document).status_code == 401
    assert post(stranger, course, "import/check", document).status_code == 404
    report = post(member, course, "import/check", document)
    assert report.status_code == 200, report.text
    report = report.json()
    assert report["readable"] and report["version"] == "quiz-import-v2"
    assert (report["total"], report["ok"], report["warnings"], report["errors"]) == (6, 2, 1, 3)
    by_position = {item["position"]: item for item in report["items"]}
    assert by_position[1]["status"] == "OK" and by_position[1]["type"] == "SHORT_ANSWER"
    assert [i["code"] for i in by_position[2]["issues"]] == ["NO_EXPLANATION"]
    assert by_position[3]["status"] == "ERROR"
    assert by_position[3]["issues"][0]["code"] == "INVALID_CONTENT"
    assert by_position[3]["stem"] == "Broken"
    assert [i["code"] for i in by_position[4]["issues"]] == ["DUPLICATE_IN_FILE"]
    assert "question 1" in by_position[4]["issues"][0]["message"]
    assert [i["code"] for i in by_position[5]["issues"]] == ["UNKNOWN_UNIT"]
    assert by_position[6]["status"] == "OK" and by_position[6]["course_unit"] == "logika"
    # Lines point at each question's opening brace in the indented file.
    lines = [item["line"] for item in report["items"]]
    assert lines == sorted(lines) and len(set(lines)) == 6 and lines[0] == 4
    assert owner.get(f"/courses/{course}/questions", params={"status": "DRAFT"}).json() == []


def test_check_flags_existing_and_unreadable_files(clients):
    owner, member, _, course = clients
    assert post(owner, course, "import", file(short("Mine", explanation="Why"))).status_code == 201
    report = post(owner, course, "import/check", file(short("mine", explanation="Why"))).json()
    assert report["items"][0]["status"] == "WARNING"
    assert report["items"][0]["issues"][0]["code"] == "DUPLICATE_OWN"
    # Another student's draft is not theirs to collide with.
    other = post(member, course, "import/check", file(short("Mine"))).json()["items"][0]
    assert [i["code"] for i in other["issues"]] == ["NO_EXPLANATION"]
    for bad in ("{", "[]", json.dumps({"version": "quiz-import-v3", "questions": [1]})):
        result = post(owner, course, "import/check", bad).json()
        assert result["readable"] is False and result["message"] and result["items"] == []
    v1 = {"version": "quiz-import-v1", "questions": [short("Old", course_unit="Logika")]}
    first = post(owner, course, "import/check", v1).json()["items"][0]
    assert first["issues"][0]["code"] == "NEEDS_V2"
    wrong_type = owner.post(
        f"/courses/{course}/questions/import/check", content="{}", headers={"Content-Type": "x/y"}
    )
    assert wrong_type.status_code == 415
    assert post(owner, uuid4(), "import/check", file(short("X"))).status_code == 404


def test_import_places_questions_in_named_units(clients):
    owner, _, _, course = clients
    logic = unit(owner, course, "Logika")
    sets = unit(owner, course, "Skupovi")
    document = file(
        short("In file unit", explanation="Why"),
        short("Own unit", explanation="Why", course_unit="Skupovi"),
        course_unit="Logika",
    )
    rows = post(owner, course, "import", document).json()
    assert [row["unit_ids"] for row in rows] == [[logic], [sets]]
    # A file naming no unit still takes the unit chosen in the request.
    fallback = post(owner, course, "import", file(short("Loose")), unit_ids=sets).json()
    assert fallback[0]["unit_ids"] == [sets]
    unknown = post(owner, course, "import", file(short("Lost", course_unit="Nema")))
    assert unknown.status_code == 422 and "Nema" in unknown.json()["detail"]
    owner.post(f"/units/{sets}/archive")
    archived = post(owner, course, "import", file(short("Gone", course_unit="Skupovi")))
    assert archived.status_code == 422
    v1 = {"version": "quiz-import-v1", "questions": [short("Old", course_unit="Logika")]}
    assert post(owner, course, "import", v1).status_code == 422


def test_numeric_unit_and_course_unit_do_not_clash(clients):
    owner, _, _, course = clients
    unit(owner, course, "Fizika")
    numeric = {
        "type": "NUMERIC",
        "stem": "Gravity?",
        "correct_value": "9.81",
        "unit": "m/s²",
        "course_unit": "Fizika",
    }
    report = post(owner, course, "import/check", file(numeric)).json()
    assert (
        report["items"][0]["status"] == "WARNING" and report["items"][0]["course_unit"] == "Fizika"
    )
    rows = post(owner, course, "import", file(numeric)).json()
    assert rows[0]["unit"] == "m/s²" and len(rows[0]["unit_ids"]) == 1


def test_skip_invalid_imports_only_the_good_questions(clients):
    owner, _, _, course = clients
    unit(owner, course, "Logika")
    document = file(
        short("Good one", explanation="Why", course_unit="Logika"),
        {"type": "TRUE_FALSE", "stem": "Broken", "correct_answer": "yes"},
        short("Wrong unit", course_unit="Nema"),
        short("Good two"),
    )
    assert post(owner, course, "import", document).status_code == 422
    assert owner.get(f"/courses/{course}/questions", params={"status": "DRAFT"}).json() == []
    result = post(owner, course, "import", document, skip_invalid=True)
    assert result.status_code == 201, result.text
    assert [row["stem"] for row in result.json()] == ["Good one", "Good two"]
    nothing = post(owner, course, "import", file({"type": "NOPE"}), skip_invalid=True)
    assert nothing.status_code == 422
    assert post(owner, course, "import", "{", skip_invalid=True).status_code == 422


def test_duplicate_policies(clients):
    owner, _, _, course = clients
    first = post(owner, course, "import", file(short("Keep", explanation="Old"))).json()[0]
    logic = unit(owner, course, "Logika")
    owner.patch(f"/questions/{first['id']}/units", json={"unit_ids": [logic]})
    again = file(short("keep", explanation="New"), short("Fresh", explanation="Why"))
    assert post(owner, course, "import", again).status_code == 409
    skipped = post(owner, course, "import", again, duplicates="SKIP").json()
    assert [row["stem"] for row in skipped] == ["Fresh"]
    document = file(short("keep", explanation="New"), short("Other", explanation="Why"))
    replaced = post(owner, course, "import", document, duplicates="REPLACE").json()
    assert [row["stem"] for row in replaced] == ["keep", "Other"]
    kept = owner.get(f"/questions/{first['id']}").json()
    assert kept["explanation"] == "New" and kept["stem"] == "keep"
    assert kept["unit_ids"] == [logic] and kept["status"] == "DRAFT"
    reasons = [v["reason"] for v in owner.get(f"/questions/{first['id']}/versions").json()]
    assert reasons == ["CREATED", "EDITED"]
    # Once sent for review a question is no longer replaced.
    assert owner.post(f"/questions/{first['id']}/submit").status_code == 200
    third = file(short("KEEP", explanation="Third"))
    untouched = post(owner, course, "import", third, duplicates="REPLACE")
    assert untouched.json() == []
    assert owner.get(f"/questions/{first['id']}").json()["explanation"] == "New"


def test_import_straight_to_review(clients):
    owner, member, _, course = clients
    document = file(short("Ready", explanation="Why"))
    rows = post(owner, course, "import", document, import_as="PENDING_REVIEW").json()
    assert rows[0]["status"] == "PENDING_REVIEW"
    reasons = [v["reason"] for v in owner.get(f"/questions/{rows[0]['id']}/versions").json()]
    assert reasons == ["CREATED", "SUBMITTED"]
    assert member.get(f"/courses/{course}/questions").json() == []
    assert (
        post(owner, course, "import", file(short("Ready 2")), import_as="LIVE").status_code == 422
    )
