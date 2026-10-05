"""Preserve unfinished attempts as terminal, ungraded abandoned history."""

from sqlalchemy import text

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
ALTER TABLE quiz_attempts ADD COLUMN abandoned_at TIMESTAMPTZ;
ALTER TABLE quiz_attempts DROP CONSTRAINT ck_attempt_status;
ALTER TABLE quiz_attempts DROP CONSTRAINT ck_attempt_submission;
ALTER TABLE quiz_attempts ADD CONSTRAINT ck_attempt_status
    CHECK (status IN ('ACTIVE','SUBMITTED','ABANDONED'));
ALTER TABLE quiz_attempts ADD CONSTRAINT ck_attempt_submission CHECK (
    (status = 'ACTIVE' AND submitted_at IS NULL AND abandoned_at IS NULL) OR
    (status = 'SUBMITTED' AND submitted_at IS NOT NULL AND abandoned_at IS NULL) OR
    (status = 'ABANDONED' AND submitted_at IS NULL AND abandoned_at IS NOT NULL)
);
""")


def downgrade() -> None:
    # Refuse a lossy downgrade: neither delete history nor turn it back into active work.
    if op.get_bind().scalar(
        text("SELECT EXISTS (SELECT 1 FROM quiz_attempts WHERE status = 'ABANDONED')")
    ):
        raise RuntimeError(
            "Cannot downgrade 0015 while abandoned attempts exist; "
            "preserve history with a pre-upgrade backup."
        )
    op.execute("""
ALTER TABLE quiz_attempts DROP CONSTRAINT ck_attempt_submission;
ALTER TABLE quiz_attempts DROP CONSTRAINT ck_attempt_status;
ALTER TABLE quiz_attempts ADD CONSTRAINT ck_attempt_status
    CHECK (status IN ('ACTIVE','SUBMITTED'));
ALTER TABLE quiz_attempts ADD CONSTRAINT ck_attempt_submission CHECK (
    (status = 'ACTIVE' AND submitted_at IS NULL) OR
    (status = 'SUBMITTED' AND submitted_at IS NOT NULL)
);
ALTER TABLE quiz_attempts DROP COLUMN abandoned_at;
""")
