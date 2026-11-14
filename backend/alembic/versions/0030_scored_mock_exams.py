"""Let a generated mock exam carry a frozen scoring rule, like a past-paper session."""

from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A PAPER session always has a scoring rule and no other mode may, except MOCK, which has one
    # only when it was started as a timed, scored exam simulation.
    op.execute("""
ALTER TABLE quizzes DROP CONSTRAINT ck_quiz_selection_mode_paper;
ALTER TABLE quizzes ADD CONSTRAINT ck_quiz_selection_mode_paper
    CHECK (selection_mode IS NULL OR selection_mode = 'MOCK'
           OR (selection_mode = 'PAPER') = (scoring IS NOT NULL));
""")


def downgrade() -> None:
    # Scored mock exams lose only their recorded mode (analytics); sessions, answers and scores
    # stay as they were, since a session without a recorded mode may keep its scoring rule.
    op.execute("""
UPDATE quizzes SET selection_mode = NULL WHERE selection_mode = 'MOCK' AND scoring IS NOT NULL;
ALTER TABLE quizzes DROP CONSTRAINT ck_quiz_selection_mode_paper;
ALTER TABLE quizzes ADD CONSTRAINT ck_quiz_selection_mode_paper
    CHECK (selection_mode IS NULL OR (selection_mode = 'PAPER') = (scoring IS NOT NULL));
""")
