"""Student self-assessment of short answers, stored apart from the grade."""

from sqlalchemy import text

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
ALTER TABLE answers ADD COLUMN self_review VARCHAR(10);
ALTER TABLE answers ADD COLUMN self_reviewed_at TIMESTAMPTZ;
ALTER TABLE answers ADD CONSTRAINT ck_answer_self_review
    CHECK (self_review IS NULL OR self_review IN ('CORRECT','INCORRECT'));
ALTER TABLE answers ADD CONSTRAINT ck_answer_self_review_time
    CHECK ((self_review IS NULL) = (self_reviewed_at IS NULL));
ALTER TABLE answers ADD CONSTRAINT ck_answer_self_review_pending
    CHECK (self_review IS NULL OR grading_method = 'PENDING_SEMANTIC');
""")


def downgrade() -> None:
    recorded = op.get_bind().scalar(
        text("SELECT count(*) FROM answers WHERE self_review IS NOT NULL")
    )
    if recorded:
        raise RuntimeError(
            "Cannot downgrade: short-answer self-assessments exist; clear them first"
        )
    op.execute("""
ALTER TABLE answers DROP CONSTRAINT ck_answer_self_review_pending;
ALTER TABLE answers DROP CONSTRAINT ck_answer_self_review_time;
ALTER TABLE answers DROP CONSTRAINT ck_answer_self_review;
ALTER TABLE answers DROP COLUMN self_reviewed_at;
ALTER TABLE answers DROP COLUMN self_review;
""")
