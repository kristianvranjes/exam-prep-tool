from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from app.schemas.question import QuestionType

Flag = Literal[
    "NEGATIVE_DISCRIMINATION", "STRONG_DISTRACTOR", "TOO_HARD", "TOO_EASY", "UNUSED_DISTRACTOR"
]
OptionFlag = Literal["STRONG_DISTRACTOR", "UNUSED_DISTRACTOR"]


class OptionAnalysis(BaseModel):
    """How often an option was chosen; group shares need enough ranked students."""

    position: int
    text: str
    is_key: bool
    count: int
    share: float
    upper_share: float | None
    lower_share: float | None
    flag: OptionFlag | None


class ItemAnalysis(BaseModel):
    """Aggregate statistics for one approved question; never per student.

    Below `min_sample_size` counted answers only the counts are reported.
    """

    question_id: UUID
    type: QuestionType
    stem: str
    # Students whose first graded answer to the current version is counted.
    sample_size: int
    # Students with graded answers to earlier versions, which are not counted.
    earlier_version_sample: int
    enough_data: bool
    # Share answered correctly (higher is easier).
    difficulty: float | None
    upper_correct: float | None
    lower_correct: float | None
    discrimination: float | None
    ranked_size: int
    group_size: int | None
    flags: list[Flag]
    options: list[OptionAnalysis]


class ItemAnalysisList(BaseModel):
    analysis_version: str
    min_sample_size: int
    # Approved questions with any graded answer, before pagination.
    total: int
    analysed: int
    flagged: int
    items: list[ItemAnalysis]
