from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.question_report import ModeratorReport, ReportCreate, ReportReceipt
from app.services.reports import create_report, dismiss_report, fix_report

router = APIRouter(tags=["question reports"])


@router.post("/questions/{question_id}/reports", response_model=ReportReceipt, status_code=201)
def create(
    question_id: UUID,
    data: ReportCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReportReceipt:
    return create_report(db, user, question_id, data)


@router.post("/question-reports/{report_id}/dismiss", response_model=ModeratorReport)
def dismiss(
    report_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ModeratorReport:
    return dismiss_report(db, user, report_id)


@router.post("/question-reports/{report_id}/resolve", response_model=ModeratorReport)
def resolve(
    report_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ModeratorReport:
    """Close a report after correcting the question (23c "Označi riješeno")."""
    return fix_report(db, user, report_id)
