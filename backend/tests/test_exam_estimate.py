from decimal import Decimal
from uuid import uuid4

import pytest

from app.services.exam_estimate import MIN_ANSWERS, Evidence, estimate_topics, exam_points_by_unit

LOGIC, SETS = uuid4(), uuid4()
Q1, Q2, Q3 = uuid4(), uuid4(), uuid4()
P1, P2 = uuid4(), uuid4()


def test_points_are_averaged_over_papers_and_shared_between_linked_topics():
    papers = [(P1, Decimal(20)), (P2, None)]
    items = [
        (P1, Q1, Decimal(4)),
        (P1, Q2, Decimal(6)),
        (P2, Q1, Decimal(2)),
        (P2, Q3, Decimal(8)),  # in no scope topic: counts in the total only
    ]
    units_of = {Q1: [LOGIC], Q2: [LOGIC, SETS]}
    points, total, threshold = exam_points_by_unit(papers, items, units_of)
    assert points == {LOGIC: pytest.approx((4 + 3 + 2) / 2), SETS: pytest.approx(3 / 2)}
    assert total == pytest.approx((10 + 10) / 2)
    assert threshold == 20


def test_without_papers_nothing_is_estimated():
    assert exam_points_by_unit([], [], {}) == ({}, None, None)


def topics():
    return [(LOGIC, "Logika", 0, 10.0), (SETS, "Skupovi", 1, 6.0)]


def test_a_topic_is_estimated_from_its_own_accuracy_and_ranked_by_points_to_gain():
    rows, estimate = estimate_topics(topics(), {LOGIC: Evidence(10, 5.0), SETS: Evidence(10, 10.0)})
    assert [row.title for row in rows] == ["Logika", "Skupovi"]
    logic = rows[0]
    assert (logic.accuracy, logic.expected_points) == (0.5, 5.0)
    assert logic.gain_points == 3.5  # 10 x 0.85 - 5
    assert rows[1].gain_points == 0  # already above the target
    assert estimate is not None
    assert estimate.expected == 11.0  # 5 + 6
    assert estimate.low < estimate.expected < estimate.high <= 16.0


def test_a_topic_without_answers_uses_the_pooled_accuracy_and_widens_the_range():
    rows, estimate = estimate_topics(topics(), {LOGIC: Evidence(MIN_ANSWERS, 8.0)})
    sets = next(row for row in rows if row.title == "Skupovi")
    assert (sets.answer_count, sets.accuracy) == (0, None)
    assert sets.expected_points == pytest.approx(6 * 0.8, abs=0.01)
    assert estimate is not None
    assert estimate.high - estimate.low > 6  # the untouched topic spans 0 to its full points


def test_no_range_before_enough_answers():
    rows, estimate = estimate_topics(topics(), {LOGIC: Evidence(MIN_ANSWERS - 1, 9.0)})
    assert estimate is None
    assert rows[0].expected_points is not None


def test_nothing_can_be_estimated_without_any_answer():
    rows, estimate = estimate_topics(topics(), {})
    assert estimate is None
    assert all(row.expected_points is None and row.gain_points is None for row in rows)
    assert [row.title for row in rows] == ["Logika", "Skupovi"]  # course order
