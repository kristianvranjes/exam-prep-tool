"""The student's own rating of a card, given during a session, kept on the answer."""

from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable and not backfilled. A rating is only possible on a checked answer; submission
    # reschedules the card from it once, instead of from the graded result.
    op.execute("""
ALTER TABLE answers
    ADD COLUMN rating VARCHAR(10),
    ADD CONSTRAINT ck_answer_rating CHECK (
        rating IS NULL OR (rating IN ('AGAIN', 'HARD', 'GOOD', 'EASY') AND checked_at IS NOT NULL));
""")


def downgrade() -> None:
    # Ratings already applied stay in review_rating_events and on the cards; only the pending ones
    # of unfinished sessions are lost.
    op.execute("""
ALTER TABLE answers DROP CONSTRAINT ck_answer_rating, DROP COLUMN rating;
""")
