"""Year of study on courses, finished status on memberships and per-user display preferences."""

from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
ALTER TABLE courses ADD COLUMN year_of_study SMALLINT;
ALTER TABLE courses ADD CONSTRAINT ck_course_year_of_study
    CHECK (year_of_study IS NULL OR year_of_study BETWEEN 1 AND 5);

ALTER TABLE course_memberships ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE course_memberships ADD CONSTRAINT ck_course_membership_status
    CHECK (status IN ('ACTIVE', 'FINISHED'));

CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    palette VARCHAR(10) NOT NULL DEFAULT 'dark',
    font_scale_percent SMALLINT NOT NULL DEFAULT 100,
    answer_markers VARCHAR(7) NOT NULL DEFAULT 'letters',
    custom_background VARCHAR(7),
    custom_text VARCHAR(7),
    custom_accent VARCHAR(7),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_user_preferences_palette
        CHECK (palette IN ('dark', 'light', 'night', 'contrast', 'custom', 'system')),
    CONSTRAINT ck_user_preferences_font_scale CHECK (font_scale_percent IN (90, 100, 115, 130)),
    CONSTRAINT ck_user_preferences_markers CHECK (answer_markers IN ('letters', 'shapes')),
    CONSTRAINT ck_user_preferences_custom CHECK (
        (custom_background IS NULL AND custom_text IS NULL AND custom_accent IS NULL)
        OR (custom_background IS NOT NULL AND custom_text IS NOT NULL
            AND custom_accent IS NOT NULL
            AND custom_background ~ '^#[0-9a-f]{6}$' AND custom_text ~ '^#[0-9a-f]{6}$'
            AND custom_accent ~ '^#[0-9a-f]{6}$')),
    CONSTRAINT ck_user_preferences_custom_palette
        CHECK (palette <> 'custom' OR custom_background IS NOT NULL)
);
""")


def downgrade() -> None:
    # Courses and memberships stay; the year of study, finished marks and preferences are lost.
    op.execute("""
DROP TABLE user_preferences;
ALTER TABLE course_memberships DROP CONSTRAINT ck_course_membership_status;
ALTER TABLE course_memberships DROP COLUMN status;
ALTER TABLE courses DROP CONSTRAINT ck_course_year_of_study;
ALTER TABLE courses DROP COLUMN year_of_study;
""")
