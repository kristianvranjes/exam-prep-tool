import pytest
from datetime import datetime, timedelta
from uuid import uuid4

from app.models.user_question_progress import UserQuestionProgress, calculate_due_date
from app.services.scheduling import SchedulingService


@pytest.fixture
def test_db():
    # Mock database session
    from unittest.mock import MagicMock
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    return db


def test_calculate_due_date():
    base_timestamp = datetime(2023, 1, 1, 12, 0, 0)

    # Test stage 0
    due_date = calculate_due_date(0, base_timestamp)
    assert due_date == base_timestamp + timedelta(minutes=10)

    # Test stage 1
    due_date = calculate_due_date(1, base_timestamp)
    assert due_date == base_timestamp + timedelta(days=1)

    # Test stage 2
    due_date = calculate_due_date(2, base_timestamp)
    assert due_date == base_timestamp + timedelta(days=3)

    # Test stage 3
    due_date = calculate_due_date(3, base_timestamp)
    assert due_date == base_timestamp + timedelta(days=7)

    # Test stage 4
    due_date = calculate_due_date(4, base_timestamp)
    assert due_date == base_timestamp + timedelta(days=14)

    # Test stage 5
    due_date = calculate_due_date(5, base_timestamp)
    assert due_date == base_timestamp + timedelta(days=30)

    # Test invalid stage
    with pytest.raises(ValueError):
        calculate_due_date(6, base_timestamp)


def test_update_progress_new_record(test_db):
    user_id = uuid4()
    source_question_id = uuid4()
    submission_timestamp = datetime.now()

    service = SchedulingService(test_db)
    progress = service.update_progress(user_id, source_question_id, "CORRECT", submission_timestamp)

    assert progress.user_id == user_id
    assert progress.source_question_id == source_question_id
    assert progress.stage == 1
    assert progress.due_at == calculate_due_date(1, submission_timestamp)
    assert progress.last_attempted_at == submission_timestamp


def test_update_progress_existing_record(test_db):
    user_id = uuid4()
    source_question_id = uuid4()
    submission_timestamp = datetime.now()

    # Mock existing progress record
    existing_progress = UserQuestionProgress(
        user_id=user_id,
        source_question_id=source_question_id,
        stage=2,
        due_at=submission_timestamp + timedelta(days=3),
        last_attempted_at=submission_timestamp - timedelta(days=1),
    )
    test_db.query.return_value.filter.return_value.first.return_value = existing_progress

    service = SchedulingService(test_db)
    progress = service.update_progress(user_id, source_question_id, "CORRECT", submission_timestamp)

    assert progress.user_id == user_id
    assert progress.source_question_id == source_question_id
    assert progress.stage == 3
    assert progress.due_at == calculate_due_date(3, submission_timestamp)
    assert progress.last_attempted_at == submission_timestamp


def test_update_progress_pending_status(test_db):
    user_id = uuid4()
    source_question_id = uuid4()
    submission_timestamp = datetime.now()

    # Mock existing progress record
    existing_progress = UserQuestionProgress(
        user_id=user_id,
        source_question_id=source_question_id,
        stage=2,
        due_at=submission_timestamp + timedelta(days=3),
        last_attempted_at=submission_timestamp - timedelta(days=1),
    )
    test_db.query.return_value.filter.return_value.first.return_value = existing_progress

    service = SchedulingService(test_db)
    progress = service.update_progress(user_id, source_question_id, "PENDING", submission_timestamp)

    assert progress.user_id == user_id
    assert progress.source_question_id == source_question_id
    assert progress.stage == 2
    assert progress.due_at == submission_timestamp + timedelta(days=3)
    assert progress.last_attempted_at == submission_timestamp


def test_get_progress(test_db):
    user_id = uuid4()
    source_question_id = uuid4()

    # Mock existing progress record
    existing_progress = UserQuestionProgress(
        user_id=user_id,
        source_question_id=source_question_id,
        stage=2,
        due_at=datetime.now() + timedelta(days=3),
        last_attempted_at=datetime.now() - timedelta(days=1),
    )
    test_db.query.return_value.filter.return_value.first.return_value = existing_progress

    service = SchedulingService(test_db)
    progress = service.get_progress(user_id, source_question_id)

    assert progress == existing_progress


def test_get_progress_not_found(test_db):
    user_id = uuid4()
    source_question_id = uuid4()

    # Mock no progress record found
    test_db.query.return_value.filter.return_value.first.return_value = None

    service = SchedulingService(test_db)
    progress = service.get_progress(user_id, source_question_id)

    assert progress is None