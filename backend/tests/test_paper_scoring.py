from decimal import Decimal

import pytest

from app.services.paper_scoring import ItemResult, item_points, score

D = Decimal
QUARTER = D("0.25")


def test_correct_wrong_blank_and_pending_items():
    assert item_points(ItemResult(D(2), "CORRECT"), QUARTER) == D(2)
    assert item_points(ItemResult(D(2), "INCORRECT"), QUARTER) == D("-0.50")
    assert item_points(ItemResult(D(2), None), QUARTER) == 0
    assert item_points(ItemResult(D(3), "PENDING"), QUARTER) is None
    assert item_points(ItemResult(D(2), "INCORRECT"), D(0)) == 0


def test_a_partly_right_answer_earns_its_share_and_costs_nothing():
    half = ItemResult(D(2), "INCORRECT", D("0.5"))
    assert item_points(half, QUARTER) == D(1)
    assert item_points(ItemResult(D(1), "INCORRECT", D("0.5")), QUARTER) == D("0.50")
    # Fully wrong (fraction 0) and graded before partial credit (None) still pay the penalty.
    assert item_points(ItemResult(D(2), "INCORRECT", D(0)), QUARTER) == D("-0.50")
    assert item_points(ItemResult(D(2), "INCORRECT", None), QUARTER) == D("-0.50")
    result = score(
        [half, ItemResult(D(2), "CORRECT", D(1)), ItemResult(D(2), "INCORRECT", D(0))],
        QUARTER,
        None,
    )
    assert (result.earned, result.correct_points, result.penalty_points) == (
        D("2.50"),
        D(3),
        D("0.50"),
    )
    assert result.max_points == 6


def test_deductions_round_half_up_to_hundredths():
    # 1.5 * 0.333 = 0.4995 -> 0.50
    assert item_points(ItemResult(D("1.5"), "INCORRECT"), D("0.333")) == D("-0.50")


def test_totals_report_pending_and_blanks_separately_and_may_go_negative():
    result = score(
        [
            ItemResult(D(2), "CORRECT"),
            ItemResult(D(2), "INCORRECT"),
            ItemResult(D(1), None),
            ItemResult(D(3), "PENDING"),
        ],
        QUARTER,
        None,
    )
    assert (result.earned, result.max_points) == (D("1.50"), D(8))
    assert (result.correct_points, result.penalty_points, result.pending_points) == (
        D(2),
        D("0.50"),
        D(3),
    )
    assert (result.unanswered_count, result.passed) == (1, None)
    negative = score([ItemResult(D(4), "INCORRECT")], QUARTER, None)
    assert negative.earned == D("-1.00")


@pytest.mark.parametrize(
    ("items", "passed"),
    [
        ([ItemResult(D(4), "CORRECT")], True),
        ([ItemResult(D(3), "CORRECT"), ItemResult(D(1), None)], False),
        # Pending short-answer points could still reach the mark: undecided.
        ([ItemResult(D(3), "CORRECT"), ItemResult(D(2), "PENDING")], None),
        ([ItemResult(D(1), "CORRECT"), ItemResult(D(2), "PENDING")], False),
    ],
)
def test_pass_mark(items, passed):
    assert score(items, QUARTER, D(4)).passed is passed
