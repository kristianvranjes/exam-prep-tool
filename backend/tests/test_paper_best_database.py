import os

import pytest
from test_materials import clients as clients
from test_paper_sessions_database import published, take
from test_practice_database import bank as bank
from test_practice_database import payload

db_only = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")


def attempt_score(member, course, path, answer_all):
    """Takes the paper, answers every question or just the first, submits and returns the score."""
    attempt = take(member, path)
    session = f"/courses/{course}/attempts/{attempt['id']}"
    for question in attempt["questions"] if answer_all else attempt["questions"][:1]:
        saved = member.patch(f"{session}/answers/{question['id']}", json=payload(question))
        assert saved.status_code == 200, saved.text
    result = member.post(session + "/submit")
    assert result.status_code == 200, result.text
    return result.json()["score"]


def best(client, course, paper_id):
    response = client.get(f"/courses/{course}/exam-papers")
    assert response.status_code == 200, response.text
    return next(row for row in response.json()["papers"] if row["id"] == paper_id)["best"]


@db_only
def test_the_list_gives_each_student_their_own_best_finished_attempt(bank):
    owner, member, _, course, rows = bank
    paper, path = published(owner, course, rows)
    assert best(member, course, paper["id"]) is None
    first = attempt_score(member, course, path, answer_all=True)
    second = attempt_score(member, course, path, answer_all=False)
    expected = max(first["earned"], second["earned"])
    assert best(member, course, paper["id"]) == {"earned": expected, "max_points": 6}
    # An unfinished attempt does not count, and nobody sees anyone else's result.
    take(member, path)
    assert best(member, course, paper["id"]) == {"earned": expected, "max_points": 6}
    assert best(owner, course, paper["id"]) is None


@db_only
def test_an_unpublished_paper_hides_from_members_and_its_best_returns_with_it(bank):
    owner, member, _, course, rows = bank
    paper, path = published(owner, course, rows)
    score = attempt_score(member, course, path, answer_all=True)
    assert owner.post(path + "/unpublish").status_code == 200
    assert member.get(f"/courses/{course}/exam-papers").json()["papers"] == []
    assert owner.post(path + "/publish").status_code == 200
    assert best(member, course, paper["id"])["earned"] == score["earned"]
