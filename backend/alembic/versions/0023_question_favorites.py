"""Private question favorites per student; deliberately no backfill."""

from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE question_favorites (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_question_favorite_user_question UNIQUE (user_id, question_id)
);
CREATE INDEX ix_question_favorites_question_id ON question_favorites(question_id);
""")


def downgrade() -> None:
    op.drop_table("question_favorites")
