"""Pure, deterministic item analysis of bank questions from graded answers.

No database access: the service loads graded answers and snapshot options, and this
module turns them into statistics. The rules are documented in
docs/COMMUNITY.md#item-analysis-r14.
"""

from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from fractions import Fraction
from uuid import UUID

from app.schemas.item_analysis import Flag, OptionFlag

ANALYSIS_VERSION = "item-analysis-v1"
# Statistics stay hidden until this many students have a counted answer.
MIN_SAMPLE_SIZE = 30
# Kelley's upper and lower 27 % groups.
GROUP_SHARE = Fraction(27, 100)
# With fewer students per group, discrimination and group shares are noise.
MIN_GROUP_SIZE = 5
TOO_EASY_ABOVE = Fraction(95, 100)
TOO_HARD_BELOW = Fraction(20, 100)
# One student moves a group of eight by 0.125, so only clear reversals are flagged.
NEGATIVE_DISCRIMINATION_AT = Fraction(-10, 100)
UNUSED_DISTRACTOR_BELOW = Fraction(5, 100)

# Most likely to need a moderator first: a probable wrong key before an easy question.
FLAG_ORDER: tuple[Flag, ...] = (
    "NEGATIVE_DISCRIMINATION",
    "STRONG_DISTRACTOR",
    "TOO_HARD",
    "TOO_EASY",
    "UNUSED_DISTRACTOR",
)


@dataclass(frozen=True)
class GradedAnswer:
    """One CORRECT or INCORRECT answer to the current version of a bank question."""

    student: UUID
    question: UUID
    answered_at: datetime
    # Breaks ties between answers saved at the same moment.
    answer_id: UUID
    correct: bool
    # The snapshot option position chosen; None for types without options.
    choice: int | None = None


@dataclass(frozen=True)
class Option:
    position: int
    text: str
    is_key: bool


@dataclass(frozen=True)
class OptionStats:
    position: int
    text: str
    is_key: bool
    count: int
    share: float
    upper_share: float | None
    lower_share: float | None
    flag: OptionFlag | None


@dataclass(frozen=True)
class ItemStats:
    question: UUID
    # Students with a counted answer; every other field is empty below MIN_SAMPLE_SIZE.
    sample_size: int
    # Students who also answered another question, and so could be ranked.
    ranked_size: int = 0
    group_size: int | None = None
    difficulty: float | None = None
    upper_correct: float | None = None
    lower_correct: float | None = None
    discrimination: float | None = None
    options: tuple[OptionStats, ...] = ()
    flags: tuple[Flag, ...] = ()

    @property
    def enough_data(self) -> bool:
        return self.sample_size >= MIN_SAMPLE_SIZE


# A group member and their weight; tied students at the cut share the remaining places.
Group = list[tuple[Fraction, GradedAnswer]]


def first_answers(answers: Iterable[GradedAnswer]) -> list[GradedAnswer]:
    """Keep each student's earliest graded answer per question.

    Later repeats measure practice with the question rather than the question itself.
    """
    first: dict[tuple[UUID, UUID], GradedAnswer] = {}
    for answer in answers:
        key = (answer.student, answer.question)
        kept = first.get(key)
        if kept is None or (answer.answered_at, answer.answer_id) < (
            kept.answered_at,
            kept.answer_id,
        ):
            first[key] = answer
    return list(first.values())


def analyse(
    answers: Iterable[GradedAnswer], options: Mapping[UUID, Sequence[Option]]
) -> dict[UUID, ItemStats]:
    """Statistics for every question with at least one counted answer.

    A student's ability for a question is their share correct on their counted
    answers to the course's other questions (the rest score), so the question being
    judged does not judge itself.
    """
    counted = first_answers(answers)
    totals: dict[UUID, list[int]] = defaultdict(lambda: [0, 0])
    by_question: dict[UUID, list[GradedAnswer]] = defaultdict(list)
    for answer in counted:
        totals[answer.student][0] += answer.correct
        totals[answer.student][1] += 1
        by_question[answer.question].append(answer)
    return {
        question: item_stats(question, rows, totals, options.get(question, ()))
        for question, rows in by_question.items()
    }


def item_stats(
    question: UUID,
    rows: Sequence[GradedAnswer],
    totals: Mapping[UUID, Sequence[int]],
    options: Sequence[Option],
) -> ItemStats:
    if len(rows) < MIN_SAMPLE_SIZE:
        return ItemStats(question, len(rows))
    difficulty = share(rows, lambda answer: answer.correct)
    ranked = [
        (rest_score(totals[answer.student], answer), answer)
        for answer in rows
        if totals[answer.student][1] > 1
    ]
    size = group_size(len(ranked))
    groups = (
        (extreme(ranked, size, upper=True), extreme(ranked, size, upper=False))
        if size >= MIN_GROUP_SIZE
        else None
    )
    upper = lower = discrimination = None
    if groups:
        upper = weighted(groups[0], lambda answer: answer.correct)
        lower = weighted(groups[1], lambda answer: answer.correct)
        assert upper is not None and lower is not None
        discrimination = upper - lower
    too_easy = difficulty > TOO_EASY_ABOVE
    stats = option_stats(rows, options, groups, too_easy)
    flags: set[Flag] = {flag for option in stats if (flag := option.flag)}
    if discrimination is not None and discrimination <= NEGATIVE_DISCRIMINATION_AT:
        flags.add("NEGATIVE_DISCRIMINATION")
    if difficulty < TOO_HARD_BELOW:
        flags.add("TOO_HARD")
    if too_easy:
        flags.add("TOO_EASY")
    return ItemStats(
        question=question,
        sample_size=len(rows),
        ranked_size=len(ranked),
        group_size=size if groups else None,
        difficulty=float(difficulty),
        upper_correct=as_float(upper),
        lower_correct=as_float(lower),
        discrimination=as_float(discrimination),
        options=stats,
        flags=tuple(flag for flag in FLAG_ORDER if flag in flags),
    )


def rest_score(total: Sequence[int], answer: GradedAnswer) -> Fraction:
    """Share correct on the student's other counted answers."""
    correct, count = total
    return Fraction(correct - answer.correct, count - 1)


def group_size(ranked: int) -> int:
    """27 % of the ranked students, rounded half up."""
    return int(GROUP_SHARE * ranked + Fraction(1, 2))


def extreme(ranked: Sequence[tuple[Fraction, GradedAnswer]], size: int, upper: bool) -> Group:
    """The `size` highest (or lowest) ranked students.

    Students tied with the last place share the places that remain, so ties never
    depend on answer order or identifiers.
    """
    ordered = sorted(ranked, key=lambda pair: pair[0], reverse=upper)
    cut = ordered[size - 1][0]
    inside = [answer for ability, answer in ordered if (ability > cut if upper else ability < cut)]
    tied = [answer for ability, answer in ordered if ability == cut]
    weight = Fraction(size - len(inside), len(tied))
    return [(Fraction(1), answer) for answer in inside] + [(weight, answer) for answer in tied]


def option_stats(
    rows: Sequence[GradedAnswer],
    options: Sequence[Option],
    groups: tuple[Group, Group] | None,
    too_easy: bool,
) -> tuple[OptionStats, ...]:
    chosen = [answer for answer in rows if answer.choice is not None]
    if not options or not chosen:
        return ()
    upper: Group = answered(groups[0]) if groups else []
    lower: Group = answered(groups[1]) if groups else []
    key = next((option for option in options if option.is_key), None)
    key_upper = weighted(upper, chooses(key.position)) if key else None
    result: list[OptionStats] = []
    for option in sorted(options, key=lambda option: option.position):
        picked = chooses(option.position)
        overall = share(chosen, picked)
        upper_share = weighted(upper, picked)
        flag: OptionFlag | None = None
        if not option.is_key:
            if upper_share is not None and key_upper is not None and upper_share > key_upper:
                flag = "STRONG_DISTRACTOR"
            # Under TOO_EASY every distractor is rarely chosen; that flag says it already.
            elif overall < UNUSED_DISTRACTOR_BELOW and not too_easy:
                flag = "UNUSED_DISTRACTOR"
        result.append(
            OptionStats(
                position=option.position,
                text=option.text,
                is_key=option.is_key,
                count=sum(1 for answer in chosen if picked(answer)),
                share=float(overall),
                upper_share=as_float(upper_share),
                lower_share=as_float(weighted(lower, picked)),
                flag=flag,
            )
        )
    return tuple(result)


def answered(group: Group) -> Group:
    return [(weight, answer) for weight, answer in group if answer.choice is not None]


def chooses(position: int) -> Callable[[GradedAnswer], bool]:
    return lambda answer: answer.choice == position


def share(rows: Sequence[GradedAnswer], test: Callable[[GradedAnswer], bool]) -> Fraction:
    return Fraction(sum(1 for answer in rows if test(answer)), len(rows))


def weighted(group: Group, test: Callable[[GradedAnswer], bool]) -> Fraction | None:
    """A share within a group, counting tied members by their weight."""
    total = sum((weight for weight, _ in group), Fraction(0))
    if not total:
        return None
    return sum((weight for weight, answer in group if test(answer)), Fraction(0)) / total


def priority(stats: ItemStats) -> tuple[int, int, int]:
    """Flagged questions first, the most serious flag first, then larger samples."""
    rank = min((FLAG_ORDER.index(flag) for flag in stats.flags), default=len(FLAG_ORDER))
    return rank, -len(stats.flags), -stats.sample_size


def as_float(value: Fraction | None) -> float | None:
    return None if value is None else float(value)
