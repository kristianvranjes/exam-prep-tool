"""Question reports and faculty quality moderation."""

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE question_reports (
    id UUID PRIMARY KEY,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    reported_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason VARCHAR(20) NOT NULL,
    details TEXT,
    status VARCHAR(10) NOT NULL,
    resolution VARCHAR(20),
    resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT ck_question_report_reason CHECK (reason IN (
        'INCORRECT_ANSWER','MULTIPLE_CORRECT','UNCLEAR','TYPO',
        'OUTDATED','DUPLICATE','OTHER')),
    CONSTRAINT ck_question_report_details CHECK (
        details IS NULL OR (length(btrim(details)) > 0 AND char_length(details) <= 1000)),
    CONSTRAINT ck_question_report_other CHECK (reason != 'OTHER' OR details IS NOT NULL),
    CONSTRAINT ck_question_report_resolution CHECK (
        (status = 'OPEN' AND resolution IS NULL AND resolved_by_user_id IS NULL
         AND resolved_at IS NULL)
        OR (status = 'RESOLVED' AND resolution IS NOT NULL
            AND resolution IN ('DISMISSED','QUESTION_ARCHIVED')
            AND resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_question_report_open
    ON question_reports(question_id, reported_by_user_id) WHERE status = 'OPEN';
CREATE INDEX ix_question_reports_reporter ON question_reports(reported_by_user_id);
CREATE INDEX ix_question_reports_queue ON question_reports(status, created_at, id);
""")


def downgrade() -> None:
    op.execute("DROP TABLE question_reports")
