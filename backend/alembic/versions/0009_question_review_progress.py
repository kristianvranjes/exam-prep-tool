"""Create question-first review state; deliberately no historical backfill."""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE question_review_progress (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    review_stage INTEGER NOT NULL,
    resolved_review_count INTEGER NOT NULL,
    correct_review_count INTEGER NOT NULL,
    incorrect_review_count INTEGER NOT NULL,
    last_result VARCHAR(20) NOT NULL,
    last_reviewed_at TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    scheduling_version VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_review_user_question UNIQUE (user_id, question_id),
    CONSTRAINT ck_review_stage CHECK (review_stage BETWEEN 0 AND 5),
    CONSTRAINT ck_review_result CHECK (last_result IN ('CORRECT','INCORRECT')),
    CONSTRAINT ck_review_counts CHECK (
        resolved_review_count > 0 AND correct_review_count >= 0 AND incorrect_review_count >= 0
        AND resolved_review_count = correct_review_count + incorrect_review_count),
    CONSTRAINT ck_review_version CHECK (length(scheduling_version) > 0)
);
CREATE INDEX ix_review_user_due_question ON question_review_progress(user_id, due_at, question_id);
CREATE INDEX ix_question_review_progress_question_id ON question_review_progress(question_id);
""")


def downgrade() -> None:
    op.drop_table("question_review_progress")
