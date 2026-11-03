"""Record how each practice session was started, for aggregate pilot metrics."""

from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable and not backfilled: sessions started before this revision stay NULL.
    op.execute("""
ALTER TABLE quizzes ADD COLUMN selection_mode VARCHAR(10);
ALTER TABLE quizzes ADD CONSTRAINT ck_quiz_selection_mode
    CHECK (selection_mode IS NULL OR selection_mode IN
        ('STANDARD','ADAPTIVE','MISTAKES','DUE','FAVORITES','MOCK','QUICK','PAPER'));
ALTER TABLE quizzes ADD CONSTRAINT ck_quiz_selection_mode_paper
    CHECK (selection_mode IS NULL OR (selection_mode = 'PAPER') = (scoring IS NOT NULL));
""")


def downgrade() -> None:
    # Analytics only: dropping the recorded modes changes no session, answer or grade.
    op.execute("""
ALTER TABLE quizzes DROP CONSTRAINT ck_quiz_selection_mode_paper;
ALTER TABLE quizzes DROP CONSTRAINT ck_quiz_selection_mode;
ALTER TABLE quizzes DROP COLUMN selection_mode;
""")
