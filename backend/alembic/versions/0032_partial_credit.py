"""Partial credit for multiple-select answers: the share of the item's points an answer earned."""

from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable and not backfilled: earlier answers keep scoring as all or nothing (NULL), and a
    # grade stays binary. The fraction only matters to point scoring (papers and mock exams).
    op.execute("""
ALTER TABLE answers
    ADD COLUMN score_fraction NUMERIC(3, 2),
    ADD CONSTRAINT ck_answer_score_fraction CHECK (
        score_fraction IS NULL
        OR (score_fraction BETWEEN 0 AND 1
            AND (grading_status = 'CORRECT') = (score_fraction = 1)));
""")


def downgrade() -> None:
    # Grades and review progress are binary and unchanged; partial answers score 0 again.
    op.execute("""
ALTER TABLE answers DROP CONSTRAINT ck_answer_score_fraction, DROP COLUMN score_fraction;
""")
