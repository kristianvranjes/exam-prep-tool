"""Persist grading provenance without regrading Phase 7 results."""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
ALTER TABLE answers ADD COLUMN grading_method VARCHAR(20);
ALTER TABLE answers ADD COLUMN grading_version VARCHAR(64);
UPDATE answers AS answer
SET grading_method = CASE WHEN answer.grading_status = 'PENDING'
    THEN 'PENDING_SEMANTIC' ELSE 'DETERMINISTIC' END,
    grading_version = 'legacy-unversioned'
FROM quiz_attempts AS attempt
WHERE answer.attempt_id = attempt.id AND attempt.status = 'SUBMITTED';
ALTER TABLE answers ADD CONSTRAINT ck_answer_grading_provenance CHECK (
    (grading_method IS NULL AND grading_version IS NULL AND grading_status = 'PENDING')
    OR (grading_method IS NOT NULL AND grading_version IS NOT NULL
        AND length(grading_version) > 0 AND (
        (grading_method = 'DETERMINISTIC' AND grading_status IN ('CORRECT','INCORRECT'))
        OR (grading_method = 'PENDING_SEMANTIC' AND grading_status = 'PENDING')))
);
""")


def downgrade() -> None:
    op.execute("""
ALTER TABLE answers DROP CONSTRAINT ck_answer_grading_provenance;
ALTER TABLE answers DROP COLUMN grading_version;
ALTER TABLE answers DROP COLUMN grading_method;
""")
