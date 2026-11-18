from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import StringConstraints, model_validator

from app.schemas.question import OwnerQuestion, StrictModel

ReportReason = Literal[
    "INCORRECT_ANSWER", "MULTIPLE_CORRECT", "UNCLEAR", "TYPO", "OUTDATED", "DUPLICATE", "OTHER"
]
ReportStatus = Literal["OPEN", "RESOLVED"]
# FIXED: a moderator corrected the question and closed the report (23c).
ReportResolution = Literal["DISMISSED", "QUESTION_ARCHIVED", "FIXED"]
Details = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class ReportCreate(StrictModel):
    reason: ReportReason
    details: Details | None = None

    @model_validator(mode="after")
    def other_requires_details(self) -> Self:
        if self.reason == "OTHER" and self.details is None:
            raise ValueError("OTHER requires details")
        return self


class ReportReceipt(StrictModel):
    id: UUID
    question_id: UUID
    reason: ReportReason
    details: str | None
    status: ReportStatus
    created_at: datetime


class ModeratorReport(ReportReceipt):
    resolution: ReportResolution | None
    resolved_by_user_id: UUID | None
    resolved_at: datetime | None
    question: OwnerQuestion
