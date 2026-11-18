import os
from uuid import uuid4

import pytest
from community_helpers import review_question
from test_materials import clients as clients
from test_unit_moderation_database import moderator as moderator

from app.services.question_similarity import jaccard, words


def test_words_fold_case_diacritics_and_drop_stop_words():
    assert words("Što je Đakovo? Čvor u ŠUMI, i a 2 + 22") == frozenset(
        {"dakovo", "cvor", "sumi", "22"}
    )
    assert words("") == frozenset()


def test_jaccard_is_the_shared_share_of_all_words():
    first, second = words("minimalni oblik funkcije"), words("minimalni oblik izraza")
    assert jaccard(first, second) == 0.5
    assert jaccard(first, frozenset()) == 0.0
    assert jaccard(first, first) == 1.0


@pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")
def test_similar_lists_the_closest_approved_questions_for_managers(clients, moderator):
    owner, member, stranger, course = clients
    stems = [
        "Odredite minimalni oblik funkcije F(A,B,C)",
        "Koliko bistabila treba brojilu modulo 10?",
        "Odredite minimalni oblik izraza zadanog tablicom",
    ]
    for stem in [*stems, "Draft that stays a draft " + uuid4().hex]:
        created = owner.post(
            f"/courses/{course}/questions",
            json={"type": "SHORT_ANSWER", "stem": stem, "reference_answer": "A"},
        )
        assert created.status_code == 201, created.text
        if stem in stems:
            path = f"/questions/{created.json()['id']}"
            assert owner.post(path + "/submit").status_code == 200
            assert review_question(owner, path + "/approve").status_code == 200
    proposal = member.post(
        f"/courses/{course}/questions",
        json={
            "type": "SHORT_ANSWER",
            "stem": "Odredite minimalni oblik funkcije F",
            "reference_answer": "A",
        },
    )
    assert proposal.status_code == 201, proposal.text
    path = f"/questions/{proposal.json()['id']}/similar"
    assert member.get(path).status_code == 403
    assert stranger.get(path).status_code == 404
    assert moderator.get(f"/questions/{uuid4()}/similar").status_code == 404
    found = moderator.get(path)
    assert found.status_code == 200, found.text
    body = found.json()
    # The nearest first; drafts and questions without shared words are left out.
    assert [item["stem"] for item in body] == [stems[0], stems[2]]
    assert body[0]["similarity"] == 1.0 and 0 < body[1]["similarity"] < body[0]["similarity"]
    assert owner.get(path).json() == body
