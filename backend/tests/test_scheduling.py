from datetime import UTC, datetime, timedelta

import pytest

from app.services.scheduling import schedule

BASE = datetime(2026, 1, 1, 12, tzinfo=UTC)


def test_correct_progression_cap_and_submission_time():
    stage = 0
    for expected_stage, days in [(1, 1), (2, 3), (3, 7), (4, 14), (5, 30), (5, 30)]:
        result = schedule(stage, "CORRECT", BASE)
        assert result.review_stage == expected_stage
        assert result.due_at == BASE + timedelta(days=days)
        assert result.scheduling_version == "leitner-v1"
        assert result == schedule(stage, "CORRECT", BASE)
        stage = result.review_stage


@pytest.mark.parametrize("stage", range(6))
def test_incorrect_reset_and_correct_after_reset(stage):
    reset = schedule(stage, "INCORRECT", BASE)
    assert reset.review_stage == 0
    assert reset.due_at == BASE + timedelta(minutes=10)
    next_review = schedule(reset.review_stage, "CORRECT", reset.due_at)
    assert next_review.review_stage == 1
    assert next_review.due_at == reset.due_at + timedelta(days=1)


@pytest.mark.parametrize("stage", range(6))
def test_pending_no_transition(stage):
    assert schedule(stage, "PENDING", BASE) is None


@pytest.mark.parametrize("stage", [-1, 6])
def test_invalid_stage(stage):
    with pytest.raises(ValueError):
        schedule(stage, "CORRECT", BASE)
