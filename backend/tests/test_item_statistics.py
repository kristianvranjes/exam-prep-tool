import random
from datetime import UTC, datetime, timedelta
from itertools import count
from uuid import UUID

import pytest

from app.services.item_analysis import choice, snapshot_options
from app.services.item_statistics import (
    MIN_SAMPLE_SIZE,
    GradedAnswer,
    ItemStats,
    Option,
    analyse,
    first_answers,
    group_size,
    priority,
)

T0 = datetime(2026, 10, 1, tzinfo=UTC)
Q = UUID(int=1)
MCQ = [Option(0, "Key", True), Option(1, "B", False), Option(2, "C", False), Option(3, "D", False)]
TF = [Option(0, "True", True), Option(1, "False", False)]
ids = count(1_000_000)


def answer(student, question, correct, choice=None, minute=0):
    return GradedAnswer(
        student=UUID(int=10_000 + student),
        question=question,
        answered_at=T0 + timedelta(minutes=minute),
        answer_id=UUID(int=next(ids)),
        correct=correct,
        choice=choice,
    )


def cohort(rows, anchors=30, key=0):
    """One student per row: (other questions answered correctly, choice on Q).

    Each student answers `anchors` other questions first, so their rest score is
    score / anchors; a row with score None answers only Q and cannot be ranked.
    """
    answers = []
    for student, (score, picked) in enumerate(rows):
        if score is not None:
            answers += [answer(student, UUID(int=100 + k), k < score) for k in range(anchors)]
        answers.append(answer(student, Q, picked == key, picked, minute=1))
    return answers


def stats(answers, options=MCQ):
    return analyse(answers, {Q: options})[Q]


def wrong(i):
    """Spread wrong answers over the three distractors."""
    return 1 + i % 3


def test_below_threshold_reports_only_the_count():
    rows = [(i, 0 if i >= 15 else wrong(i)) for i in range(MIN_SAMPLE_SIZE - 1)]
    small = stats(cohort(rows))
    assert small == ItemStats(Q, MIN_SAMPLE_SIZE - 1)
    assert not small.enough_data and small.flags == () and small.options == ()
    enough = stats(cohort([*rows, (29, 0)]))
    assert enough.enough_data and enough.difficulty is not None and len(enough.options) == 4


def test_only_each_students_first_graded_answer_counts():
    later = answer(1, Q, True, 0, minute=5)
    first = answer(1, Q, False, 2, minute=1)
    same_time = [answer(2, Q, True, 0, minute=3), answer(2, Q, False, 1, minute=3)]
    kept = first_answers([later, *same_time, first])
    assert first in kept and later not in kept
    # Saved at the same moment: the lower answer id wins, whatever the input order.
    assert same_time[0] in kept and same_time[1] not in kept
    assert first_answers([same_time[1], same_time[0]]) == [same_time[0]]


def test_a_discriminating_question_has_no_flags():
    result = stats(cohort([(i, 0 if i >= 15 else wrong(i)) for i in range(30)]))
    assert (result.sample_size, result.ranked_size, result.group_size) == (30, 30, 8)
    assert result.difficulty == 0.5
    assert (result.upper_correct, result.lower_correct, result.discrimination) == (1, 0, 1)
    assert result.flags == ()
    key, *distractors = result.options
    assert (key.is_key, key.count, key.share, key.upper_share, key.lower_share) == (
        True,
        15,
        0.5,
        1,
        0,
    )
    assert [option.count for option in distractors] == [5, 5, 5]
    assert sum(option.lower_share or 0 for option in result.options) == pytest.approx(1)


def test_negative_discrimination_and_a_strong_distractor_point_at_the_key():
    # Weaker students "get it right"; the strongest all choose C.
    result = stats(cohort([(i, 0 if i < 15 else 2) for i in range(30)]))
    assert result.discrimination == -1
    assert result.flags == ("NEGATIVE_DISCRIMINATION", "STRONG_DISTRACTOR", "UNUSED_DISTRACTOR")
    by_text = {option.text: option for option in result.options}
    assert by_text["C"].flag == "STRONG_DISTRACTOR" and by_text["C"].upper_share == 1
    assert by_text["B"].flag == by_text["D"].flag == "UNUSED_DISTRACTOR"
    assert by_text["Key"].flag is None


def test_small_reversals_are_noise_not_a_wrong_key():
    # Upper 4 of 8 correct, lower 5 of 8: -0.125 is flagged; equal groups are not.
    upper = [(29 - i, 0 if i < 4 else 1) for i in range(8)]
    middle = [(15, 0 if i % 2 else 2) for i in range(14)]
    lower = [(i, 0 if i < 5 else 3) for i in range(8)]
    result = stats(cohort(upper + middle + lower))
    assert result.discrimination == pytest.approx(-0.125)
    assert "NEGATIVE_DISCRIMINATION" in result.flags
    level = stats(cohort(upper + middle + [(i, 0 if i < 4 else 3) for i in range(8)]))
    assert level.discrimination == 0
    assert "NEGATIVE_DISCRIMINATION" not in level.flags


def test_students_tied_at_the_cut_share_the_remaining_places():
    rows = (
        [(25, 0)] * 5  # clearly upper, all correct
        + [(15, 0)] * 5
        + [(15, 1)] * 5  # ten tied at the cut: half correct
        + [(5, wrong(i)) for i in range(15)]  # fifteen tied at the bottom, all wrong
    )
    result = stats(cohort(rows))
    assert result.group_size == 8
    # Five full places plus three shared by ten: (5 + 3 * 5/10) / 8.
    assert result.upper_correct == pytest.approx(6.5 / 8)
    assert result.lower_correct == 0
    shuffled = cohort(rows)
    random.Random(7).shuffle(shuffled)
    assert stats(shuffled).discrimination == result.discrimination


def test_everyone_tied_means_no_discrimination():
    result = stats(cohort([(10, 0 if i < 12 else wrong(i)) for i in range(30)]))
    assert result.upper_correct == result.lower_correct == result.difficulty == 0.4
    assert result.discrimination == 0
    assert result.flags == ()


def test_tiny_groups_report_difficulty_without_discrimination():
    # Sixteen ranked students make groups of four; fourteen answered nothing else.
    rows = [(i, 0 if i >= 8 else wrong(i)) for i in range(16)] + [(None, 0)] * 14
    result = stats(cohort(rows))
    assert (result.sample_size, result.ranked_size, group_size(16)) == (30, 16, 4)
    assert result.group_size is None and result.discrimination is None
    assert result.upper_correct is None and result.difficulty == pytest.approx(22 / 30)
    assert all(option.upper_share is None for option in result.options)
    assert result.flags == ()
    # A seventeenth ranked student makes groups of five.
    bigger = stats(cohort([(i, 0 if i >= 8 else wrong(i)) for i in range(17)] + [(None, 0)] * 13))
    assert bigger.group_size == 5 and bigger.discrimination is not None


def test_all_correct_is_too_easy_without_unused_distractor_noise():
    result = stats(cohort([(i, 0) for i in range(30)]))
    assert result.difficulty == 1 and result.discrimination == 0
    assert result.flags == ("TOO_EASY",)
    assert all(option.flag is None for option in result.options)


@pytest.mark.parametrize(
    ("correct", "total", "flags"),
    [(5, 30, ("TOO_HARD",)), (6, 30, ()), (38, 40, ()), (39, 40, ("TOO_EASY",))],
)
def test_difficulty_thresholds_are_strict(correct, total, flags):
    # No ranking (nobody answered anything else), so only difficulty can flag.
    rows = [(None, 0 if i < correct else wrong(i)) for i in range(total)]
    result = stats(cohort(rows))
    assert result.difficulty == correct / total
    assert tuple(f for f in result.flags if f != "UNUSED_DISTRACTOR") == flags


def test_unused_distractor_is_chosen_by_under_five_percent():
    rows = [(i, 0 if i >= 17 else 1 + (i % 2)) for i in range(39)] + [(0, 3)]
    result = stats(cohort(rows))
    by_text = {option.text: option for option in result.options}
    assert by_text["D"].count == 1 and by_text["D"].flag == "UNUSED_DISTRACTOR"
    assert result.flags == ("UNUSED_DISTRACTOR",)
    two = stats(cohort([(i, 0 if i >= 17 else 1 + (i % 2)) for i in range(38)] + [(0, 3)] * 2))
    assert {option.text: option for option in two.options}["D"].flag is None


def test_strong_distractor_with_positive_discrimination():
    upper = [(29 - i, 0 if i < 3 else 2) for i in range(8)]
    middle = [(15, 0 if i % 2 else 1) for i in range(14)]
    lower = [(i, wrong(i)) for i in range(8)]
    result = stats(cohort(upper + middle + lower))
    assert result.discrimination is not None and result.discrimination > 0
    assert result.flags == ("STRONG_DISTRACTOR",)
    c = next(option for option in result.options if option.text == "C")
    assert c.flag == "STRONG_DISTRACTOR" and c.upper_share == pytest.approx(5 / 8)


def test_true_false_uses_two_fixed_options():
    result = stats(cohort([(i, 0 if i >= 10 else 1) for i in range(30)]), TF)
    assert [(o.text, o.is_key, o.count) for o in result.options] == [
        ("True", True, 20),
        ("False", False, 10),
    ]
    assert result.flags == ()


def test_answers_without_options_still_get_difficulty_and_discrimination():
    answers = [
        GradedAnswer(a.student, a.question, a.answered_at, a.answer_id, a.correct, None)
        for a in cohort([(i, 0 if i >= 15 else 1) for i in range(30)])
    ]
    result = analyse(answers, {})[Q]
    assert result.discrimination == 1 and result.options == () and result.flags == ()


def test_payloads_and_snapshots_map_to_positions():
    assert choice({"type": "MULTIPLE_CHOICE", "option_position": 2}) == 2
    assert choice({"type": "TRUE_FALSE", "value": True}) == 0
    assert choice({"type": "TRUE_FALSE", "value": False}) == 1
    # Unknown or future answer types are ignored, not errors.
    assert choice({"type": "NUMERIC", "value": "3.5"}) is None
    assert choice({"type": "MULTIPLE_SELECT", "option_positions": [0, 1]}) is None
    assert choice({"type": "MULTIPLE_CHOICE", "option_position": True}) is None
    snapshot = {
        "type": "MULTIPLE_CHOICE",
        "options": [
            {"position": 1, "text": "B", "is_correct": False},
            {"position": 0, "text": "A", "is_correct": True},
        ],
    }
    assert snapshot_options(snapshot) == [Option(1, "B", False), Option(0, "A", True)]
    assert snapshot_options({"type": "TRUE_FALSE", "correct_boolean": False}) == [
        Option(0, "True", False),
        Option(1, "False", True),
    ]
    assert snapshot_options({"type": "NUMERIC", "options": []}) == []


def test_priority_puts_likely_wrong_keys_first_then_larger_samples():
    items = [
        ItemStats(UUID(int=1), 200),
        ItemStats(UUID(int=2), 40, flags=("TOO_EASY",)),
        ItemStats(UUID(int=3), 35, flags=("NEGATIVE_DISCRIMINATION", "STRONG_DISTRACTOR")),
        ItemStats(UUID(int=4), 90, flags=("TOO_EASY",)),
        ItemStats(UUID(int=5), 12),
        ItemStats(UUID(int=6), 50, flags=("NEGATIVE_DISCRIMINATION",)),
    ]
    assert [item.question.int for item in sorted(items, key=priority)] == [3, 6, 4, 2, 1, 5]
