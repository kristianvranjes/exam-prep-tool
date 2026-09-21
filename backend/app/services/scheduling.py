from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.user_question_progress import UserQuestionProgress, calculate_due_date
from app.models.quiz import Answer


class SchedulingService:
    def __init__(self, db: Session):
        self.db = db

    def update_progress(self, user_id: str, source_question_id: str, grading_status: str, submission_timestamp: datetime) -> UserQuestionProgress:
        """
        Update the progress for a user-question pair based on the grading status.

        Args:
            user_id: The ID of the user.
            source_question_id: The ID of the source question.
            grading_status: The grading status ("CORRECT", "INCORRECT", "PENDING").
            submission_timestamp: The timestamp of the submission.

        Returns:
            The updated UserQuestionProgress record.
        """
        progress = self.db.query(UserQuestionProgress).filter(
            UserQuestionProgress.user_id == user_id,
            UserQuestionProgress.source_question_id == source_question_id,
        ).first()

        if progress is None:
            # Create a new progress record if it doesn't exist
            progress = UserQuestionProgress(
                user_id=user_id,
                source_question_id=source_question_id,
                stage=0,
                last_attempted_at=submission_timestamp,
            )
            self.db.add(progress)
        else:
            # Update the last_attempted_at timestamp
            progress.last_attempted_at = submission_timestamp

        if grading_status == "PENDING":
            # PENDING is a strict no-op
            return progress

        # Update stage and due_at based on grading status
        if grading_status == "INCORRECT":
            progress.stage = 0
        elif grading_status == "CORRECT":
            progress.stage = min(progress.stage + 1, 5)

        # Calculate the new due date
        progress.due_at = calculate_due_date(progress.stage, submission_timestamp)

        self.db.commit()
        self.db.refresh(progress)
        return progress

    def get_progress(self, user_id: str, source_question_id: str) -> Optional[UserQuestionProgress]:
        """
        Retrieve the progress for a user-question pair.

        Args:
            user_id: The ID of the user.
            source_question_id: The ID of the source question.

        Returns:
            The UserQuestionProgress record, or None if not found.
        """
        return self.db.query(UserQuestionProgress).filter(
            UserQuestionProgress.user_id == user_id,
            UserQuestionProgress.source_question_id == source_question_id,
        ).first()