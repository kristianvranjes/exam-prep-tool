"""Faculty moderation and privacy-safe community question uniqueness."""

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE faculty_moderators (
    faculty_id UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (faculty_id, user_id)
);
CREATE INDEX ix_faculty_moderators_user_id ON faculty_moderators(user_id);
CREATE UNIQUE INDEX uq_question_creator_active_stem
    ON questions(course_id, created_by_user_id, normalized_stem) WHERE status != 'ARCHIVED';
CREATE UNIQUE INDEX uq_question_approved_stem
    ON questions(course_id, normalized_stem) WHERE status = 'APPROVED';
DROP INDEX uq_question_active_stem;
""")


def downgrade() -> None:
    # Restore the stricter invariant FIRST. Conflicting community drafts cause an
    # explicit unique violation and transactional rollback, never silent deletion.
    op.execute("""
CREATE UNIQUE INDEX uq_question_active_stem
    ON questions(course_id, normalized_stem) WHERE status != 'ARCHIVED';
DROP INDEX uq_question_approved_stem;
DROP INDEX uq_question_creator_active_stem;
DROP TABLE faculty_moderators;
""")
