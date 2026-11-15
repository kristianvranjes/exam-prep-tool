from typing import Literal

from pydantic import BaseModel

IssueCode = Literal[
    "INVALID_CONTENT",
    "NEEDS_V2",
    "DUPLICATE_IN_FILE",
    "UNKNOWN_UNIT",
    "ARCHIVED_UNIT",
    "DUPLICATE_OWN",
    "DUPLICATE_APPROVED",
    "NO_EXPLANATION",
]
Severity = Literal["WARNING", "ERROR"]
DuplicatePolicy = Literal["REJECT", "SKIP", "REPLACE"]
ImportAs = Literal["DRAFT", "PENDING_REVIEW"]


class ImportIssue(BaseModel):
    code: IssueCode
    severity: Severity
    message: str


class ImportItemReport(BaseModel):
    position: int
    # Line of the question's opening brace in the file, when it can be found.
    line: int | None
    type: str | None
    stem: str | None
    unit: str | None
    status: Literal["OK", "WARNING", "ERROR"]
    issues: list[ImportIssue]


class ImportReport(BaseModel):
    """What an import would do with a file, produced without saving anything."""

    readable: bool
    # Why the file cannot be read at all; none when `readable`.
    message: str | None = None
    version: str | None = None
    total: int = 0
    ok: int = 0
    warnings: int = 0
    errors: int = 0
    items: list[ImportItemReport] = []
