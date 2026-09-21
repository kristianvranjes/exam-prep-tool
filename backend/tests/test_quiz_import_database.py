import os
from uuid import uuid4

import pytest
from community_helpers import review_question
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from test_materials import clients as clients
from test_quiz_import import document

from app.database import SessionLocal
from app.main import app
from app.models.question import Question, QuestionOption, QuestionVersion

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def test_import_review_without_ai_or_provenance(clients, monkeypatch):
    owner, member, stranger, course = clients
    monkeypatch.setenv("AI_PROVIDER", "disabled")
    path = f"/courses/{course}/questions/import"
    with TestClient(app) as anonymous:
        assert anonymous.post(path, json=document()).status_code == 401
    assert stranger.post(path, json=document()).status_code == 404
    assert owner.post(f"/courses/{uuid4()}/questions/import", json=document()).status_code == 404
    result = owner.post(path, json=document())
    assert result.status_code == 201, result.text
    rows = result.json()
    assert len(rows) == 3
    assert member.get(f"/courses/{course}/questions").json() == []
    for row in rows:
        assert row["status"] == "DRAFT" and row["source"] == "USER"
        assert row["ai_job_id"] is None and row["concept_ids"] == [] and row["source_chunks"] == []
        q = f"/questions/{row['id']}"
        assert review_question(owner, q + "/approve").status_code == 409
        assert member.post(q + "/submit").status_code in (403, 404)
        assert (
            owner.patch(q, json={"stem": row["stem"] + " Edited", "concept_ids": []}).status_code
            == 200
        )
        assert owner.post(q + "/submit").status_code == 200
        assert review_question(owner, q + "/reject", json={"reason": "Recheck"}).status_code == 200
        assert (
            owner.patch(q, json={"explanation": "Checked original material"}).json()["status"]
            == "DRAFT"
        )
        assert owner.post(q + "/submit").status_code == 200
        assert review_question(owner, q + "/approve").json()["status"] == "APPROVED"
        public = member.get(q).json()
        assert "reference_answer" not in public and "explanation" not in public
        assert owner.get(q + "/versions").json()[0]["reason"] == "CREATED"


def counts():
    with SessionLocal() as db:
        return tuple(
            db.scalar(select(func.count()).select_from(model))
            for model in (Question, QuestionOption, QuestionVersion)
        )


def test_invalid_and_conflicting_import_is_atomic(clients):
    owner, _, _, course = clients
    path = f"/courses/{course}/questions/import"
    invalid = document()
    invalid["questions"][-1]["status"] = "APPROVED"
    assert owner.post(path, json=invalid).status_code == 422
    assert counts() == (0, 0, 0)
    assert owner.post(path, json=document()).status_code == 201
    before = counts()
    conflict = document()
    conflict["questions"][0]["stem"] = "New question written before the conflict"
    assert owner.post(path, json=conflict).status_code == 409
    assert counts() == before
