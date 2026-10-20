"""Feedback mode on quizzes; checked time and confidence on answers."""

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
ALTER TABLE quizzes ADD COLUMN feedback_mode VARCHAR(10) NOT NULL DEFAULT 'END';
ALTER TABLE quizzes ADD CONSTRAINT ck_quiz_feedback_mode
    CHECK (feedback_mode IN ('END','IMMEDIATE'));
ALTER TABLE answers ADD COLUMN checked_at TIMESTAMPTZ;
ALTER TABLE answers ADD COLUMN confidence VARCHAR(10);
ALTER TABLE answers ADD CONSTRAINT ck_answer_confidence
    CHECK (confidence IS NULL OR confidence IN ('SURE','UNSURE','GUESS'));
ALTER TABLE answers ADD CONSTRAINT ck_answer_checked_graded
    CHECK (checked_at IS NULL OR grading_method IS NOT NULL);
""")


def downgrade() -> None:
    op.execute("""
ALTER TABLE answers DROP CONSTRAINT ck_answer_checked_graded;
ALTER TABLE answers DROP CONSTRAINT ck_answer_confidence;
ALTER TABLE answers DROP COLUMN confidence;
ALTER TABLE answers DROP COLUMN checked_at;
ALTER TABLE quizzes DROP CONSTRAINT ck_quiz_feedback_mode;
ALTER TABLE quizzes DROP COLUMN feedback_mode;
""")
