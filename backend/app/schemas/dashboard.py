from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class UnitResult(BaseModel):
    """How the caller did on one unit across submitted sessions; percents are whole, half up.

    Only automatically graded answers count; short answers and self-assessments never do. A question
    linked to several units counts in each, so unit figures overlap.
    """

    unit_id: UUID
    title: str
    position: int
    attempts: int
    best_percent: int | None
    last_percent: int | None


class CourseDashboard(BaseModel):
    """The figures at the top of the course page (handoff 2b).

    `units_attempted` of `units_total` active units have at least one graded answer in a submitted
    session. `average_percent` is the mean of the sessions' overall results, null without any.
    """

    as_of: datetime
    units_total: int
    units_attempted: int
    average_percent: int | None
    units: list[UnitResult]


class WeekCell(BaseModel):
    """One unit in one week: the share of correct graded answers, null when there were none."""

    percent: int | None
    graded_count: int


class UnitSeries(BaseModel):
    unit_id: UUID
    title: str
    position: int
    cells: list[WeekCell]


class ProgressSeries(BaseModel):
    """Weekly results per unit (handoff 2f). `weeks` are Monday dates in Zagreb time, oldest first,
    and every unit's `cells` line up with them."""

    weeks: list[date]
    units: list[UnitSeries]
