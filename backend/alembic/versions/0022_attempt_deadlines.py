"""Server-enforced deadlines for timed paper sessions."""

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
ALTER TABLE quiz_attempts ADD COLUMN deadline_at TIMESTAMPTZ;
ALTER TABLE quiz_attempts ADD CONSTRAINT ck_attempt_deadline
    CHECK (deadline_at IS NULL OR deadline_at > started_at);
""")


def downgrade() -> None:
    op.execute("""
ALTER TABLE quiz_attempts DROP CONSTRAINT ck_attempt_deadline;
ALTER TABLE quiz_attempts DROP COLUMN deadline_at;
""")
