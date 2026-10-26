from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from app.schemas.readiness import ReadinessRange, UnitReadiness
from app.services.readiness import (
    Review,
    Tally,
    is_retained,
    readiness_range,
    tally,
    weakest,
    wilson,
)

NOW = datetime(2026, 11, 16, 12, tzinfo=UTC)


def review(stage=1, result="CORRECT", due=timedelta(hours=12), answers=1, correct=1):
    return Review(stage, result, NOW + due, answers, correct)


def test_wilson_bounds_known_values_and_symmetry():
    assert wilson(0, 0) == (0.0, 1.0)
    assert wilson(18, 25) == pytest.approx((0.5565, 0.8405), abs=1e-4)
    low, high = wilson(3, 3)
    assert high == 1.0 and 0 < low < 1
    assert wilson(0, 3) == pytest.approx((1 - high, 1 - low))
    # The same share with fewer answers gives a wider interval around it.
    small, large = wilson(4, 5), wilson(40, 50)
    assert small[0] < large[0] < 0.8 < large[1] < small[1]


@pytest.mark.parametrize(
    ("stage", "due", "expected"),
    [
        (1, timedelta(hours=12), True),  # not due yet
        (1, -timedelta(hours=23), True),  # overdue for less than its one-day interval
        (1, -timedelta(days=1), False),  # overdue for a whole interval
        (5, -timedelta(days=29), True),
        (5, -timedelta(days=31), False),
    ],
)
def test_retention_proxy_allows_one_interval_of_overdue(stage, due, expected):
    assert is_retained(review(stage, due=due), NOW) is expected


def test_retention_proxy_needs_a_correct_last_answer():
    assert not is_retained(review(0, "INCORRECT", timedelta(minutes=5), 2, 1), NOW)


def test_tally_counts_questions_answers_and_retention():
    reviews = [
        review(2, answers=3, correct=2),
        review(0, "INCORRECT", timedelta(minutes=10), 2, 1),
        review(1, due=-timedelta(days=2)),
        None,
    ]
    assert tally(reviews, NOW) == Tally(
        questions=4, answered=3, retained=1, answers=6, correct_answers=4
    )
    assert tally([], NOW) == Tally()


def test_range_collapses_with_full_coverage_and_spans_everything_untouched():
    assert readiness_range([Tally(questions=8, answered=8, retained=6)]) == ReadinessRange(
        low=0.75, high=0.75
    )
    assert readiness_range([Tally(questions=5)]) == ReadinessRange(low=0.0, high=1.0)
    assert readiness_range([]) is None
    assert readiness_range([Tally()]) is None


def test_range_extends_retention_to_unanswered_questions_and_narrows_with_samples():
    lower, upper = wilson(18, 25)
    unit = readiness_range([Tally(questions=40, answered=25, retained=18)])
    assert unit is not None
    assert (unit.low, unit.high) == pytest.approx(
        ((18 + 15 * lower) / 40, (18 + 15 * upper) / 40), abs=1e-4
    )
    few = readiness_range([Tally(questions=40, answered=5, retained=4)])
    assert few is not None
    assert few.low < unit.low and few.high > unit.high


def test_scope_range_weights_units_by_question_count():
    scope = readiness_range([Tally(questions=30, answered=30, retained=30), Tally(questions=10)])
    assert scope == ReadinessRange(low=0.75, high=1.0)


def unit(n, low, high, *, position=None, archived=False, questions=10, retained=0):
    return UnitReadiness(
        unit_id=UUID(int=n),
        title=f"Unit {n}",
        position=n if position is None else position,
        is_archived=archived,
        question_count=questions,
        answered_count=retained,
        retained_count=retained,
        answer_count=retained,
        correct_answer_count=retained,
        coverage=None,
        accuracy=None,
        retention=None,
        readiness=ReadinessRange(low=low, high=high) if questions else None,
    )


def test_weakest_orders_by_lower_bound_then_upper_bound_then_position():
    units = [
        unit(1, 0.6, 0.8),
        unit(2, 0.0, 1.0),  # untouched
        unit(3, 0.0, 0.4),  # answered, mostly wrong
        unit(4, 0.2, 0.5, position=6),
        unit(5, 0.2, 0.5, position=5),
    ]
    assert weakest(units) == [UUID(int=3), UUID(int=2), UUID(int=5)]


def test_weakest_skips_archived_empty_and_fully_retained_units():
    units = [
        unit(1, 0.0, 1.0, archived=True),
        unit(2, 0.0, 0.0, questions=0),
        unit(3, 1.0, 1.0, retained=10),
        unit(4, 0.9, 0.95, retained=9),
    ]
    assert weakest(units) == [UUID(int=4)]
