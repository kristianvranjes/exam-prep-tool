"""Moderated question edit suggestions; applied EDITED history survives downgrade."""

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE question_edit_suggestions (
    id UUID PRIMARY KEY,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    suggested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    base_version_number INTEGER NOT NULL,
    proposed_content JSONB NOT NULL,
    note TEXT,
    status VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    resolution VARCHAR(20),
    resolution_reason TEXT,
    resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    applied_version_number INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_suggestion_base_version CHECK (base_version_number >= 1),
    CONSTRAINT ck_suggestion_content CHECK (jsonb_typeof(proposed_content) = 'object'),
    CONSTRAINT ck_suggestion_note CHECK (
        note IS NULL OR (length(btrim(note)) > 0 AND char_length(note) <= 1000)),
    CONSTRAINT ck_suggestion_status CHECK (status IN ('OPEN','RESOLVED')),
    CONSTRAINT ck_suggestion_resolution CHECK (
        resolution IS NULL OR resolution IN
        ('APPLIED','REJECTED','SUPERSEDED','QUESTION_ARCHIVED')),
    CONSTRAINT ck_suggestion_reason CHECK (
        resolution_reason IS NULL OR (length(btrim(resolution_reason)) > 0
        AND char_length(resolution_reason) <= 1000)),
    CONSTRAINT ck_suggestion_state CHECK (
        (status = 'OPEN' AND resolution IS NULL AND resolution_reason IS NULL
         AND resolved_by_user_id IS NULL AND resolved_at IS NULL AND applied_version_number IS NULL)
        OR (status = 'RESOLVED' AND resolution IS NOT NULL AND resolved_at IS NOT NULL)),
    CONSTRAINT ck_suggestion_decision CHECK (
        resolution IS NULL OR (resolution = 'APPLIED'
        AND applied_version_number IS NOT NULL AND applied_version_number > 0
        AND resolution_reason IS NULL) OR (resolution = 'REJECTED'
        AND applied_version_number IS NULL AND resolution_reason IS NOT NULL)
        OR (resolution IN ('SUPERSEDED','QUESTION_ARCHIVED')
        AND applied_version_number IS NULL AND resolution_reason IS NULL))
);
CREATE INDEX ix_suggestions_question ON question_edit_suggestions(question_id);
CREATE INDEX ix_suggestions_suggester ON question_edit_suggestions(suggested_by_user_id);
CREATE INDEX ix_suggestions_queue ON question_edit_suggestions(status, created_at, id);
CREATE UNIQUE INDEX uq_question_suggestion_open
    ON question_edit_suggestions(question_id, suggested_by_user_id) WHERE status = 'OPEN';
""")


def downgrade() -> None:
    op.execute("DROP TABLE question_edit_suggestions")
