"""Rating-based review scheduling: interval, repetitions, lapses and a history of ratings."""

from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Rows scheduled by leitner-v1 keep their version and due time. Their interval, repetitions
    # and lapses are derived from the stage so the first rating can continue from them, and
    # their last result maps to a rating: CORRECT -> GOOD, INCORRECT -> AGAIN.
    op.execute("""
ALTER TABLE question_review_progress
    ADD COLUMN interval_minutes INTEGER,
    ADD COLUMN repetitions INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN last_rating VARCHAR(10),
    ADD CONSTRAINT ck_review_interval CHECK (interval_minutes IS NULL OR interval_minutes > 0),
    ADD CONSTRAINT ck_review_repetitions CHECK (repetitions >= 0 AND lapses >= 0),
    ADD CONSTRAINT ck_review_last_rating
        CHECK (last_rating IS NULL OR last_rating IN ('AGAIN', 'HARD', 'GOOD', 'EASY'));

UPDATE question_review_progress SET
    interval_minutes = CASE review_stage
        WHEN 0 THEN 10 WHEN 1 THEN 1440 WHEN 2 THEN 4320
        WHEN 3 THEN 10080 WHEN 4 THEN 20160 ELSE 43200 END,
    repetitions = review_stage,
    lapses = incorrect_review_count,
    last_rating = CASE last_result WHEN 'CORRECT' THEN 'GOOD' ELSE 'AGAIN' END;

-- Every rating a student gives, so the history survives later reschedules.
CREATE TABLE review_rating_events (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    rating VARCHAR(10) NOT NULL,
    rated_at TIMESTAMPTZ NOT NULL,
    interval_minutes INTEGER NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    scheduling_version VARCHAR(64) NOT NULL,
    CONSTRAINT ck_rating_event_rating CHECK (rating IN ('AGAIN', 'HARD', 'GOOD', 'EASY')),
    CONSTRAINT ck_rating_event_interval CHECK (interval_minutes > 0)
);
CREATE INDEX ix_rating_event_user_question ON review_rating_events (user_id, question_id, rated_at);
""")


def downgrade() -> None:
    # Ratings and the extra scheduling fields are dropped; stages, results and due times stay.
    op.execute("""
DROP TABLE review_rating_events;
ALTER TABLE question_review_progress
    DROP CONSTRAINT ck_review_last_rating,
    DROP CONSTRAINT ck_review_repetitions,
    DROP CONSTRAINT ck_review_interval,
    DROP COLUMN last_rating,
    DROP COLUMN lapses,
    DROP COLUMN repetitions,
    DROP COLUMN interval_minutes;
""")
