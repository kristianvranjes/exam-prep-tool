"""A unit (quiz) has a review status and a reviewer: draft, under review or published."""

from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Units that exist today are already in use, so they start as published. The author is the
    # existing created_by_user_id. The status is a label for moderators: it does not hide the
    # unit's approved questions from students.
    op.execute("""
ALTER TABLE course_units
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED',
    ADD COLUMN reviewer_id UUID REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN reviewed_at TIMESTAMP WITH TIME ZONE,
    ADD CONSTRAINT ck_course_unit_status CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED')),
    ADD CONSTRAINT ck_course_unit_reviewed CHECK (
        status = 'PUBLISHED' OR (reviewer_id IS NULL AND reviewed_at IS NULL));
""")


def downgrade() -> None:
    op.execute("""
ALTER TABLE course_units
    DROP CONSTRAINT ck_course_unit_reviewed,
    DROP CONSTRAINT ck_course_unit_status,
    DROP COLUMN reviewed_at,
    DROP COLUMN reviewer_id,
    DROP COLUMN status;
""")
