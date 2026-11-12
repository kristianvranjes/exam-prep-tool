"""Course year of study, membership status and per-user interface preferences."""

from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing courses have no year until a faculty moderator sets one.
    op.execute("""
ALTER TABLE courses
    ADD COLUMN year_of_study SMALLINT,
    ADD CONSTRAINT ck_course_year_of_study
        CHECK (year_of_study IS NULL OR year_of_study BETWEEN 1 AND 6);

-- A student's own view of a course: finished courses leave the home list and hidden ones
-- are removed from it. The row, and with it access to the student's own history, stays.
ALTER TABLE course_memberships
    ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    ADD CONSTRAINT ck_membership_status CHECK (status IN ('ACTIVE', 'DONE', 'HIDDEN'));

-- One JSON document per user, validated by the API; new settings need no migration.
CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
""")


def downgrade() -> None:
    # Years, statuses and preferences are dropped; courses and memberships stay.
    op.execute("""
DROP TABLE user_preferences;
ALTER TABLE course_memberships
    DROP CONSTRAINT ck_membership_status,
    DROP COLUMN status;
ALTER TABLE courses
    DROP CONSTRAINT ck_course_year_of_study,
    DROP COLUMN year_of_study;
""")
