"""Ordered course units (cjeline) and question-unit links; downgrade drops this organization."""

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE course_units (
    id UUID PRIMARY KEY,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    title VARCHAR(150) NOT NULL,
    normalized_title VARCHAR(600) NOT NULL,
    description TEXT,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_course_unit_position UNIQUE (course_id, position)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT uq_course_unit_title UNIQUE (course_id, normalized_title),
    CONSTRAINT ck_course_unit_position CHECK (position >= 0),
    CONSTRAINT ck_course_unit_title CHECK (
        length(btrim(title)) > 0 AND char_length(title) <= 150),
    CONSTRAINT ck_course_unit_description CHECK (
        description IS NULL OR
        (length(btrim(description)) > 0 AND char_length(description) <= 2000))
);
CREATE INDEX ix_course_units_course_id ON course_units(course_id);
CREATE TABLE question_units (
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES course_units(id) ON DELETE CASCADE,
    PRIMARY KEY (question_id, unit_id)
);
CREATE INDEX ix_question_units_unit_id ON question_units(unit_id);
""")


def downgrade() -> None:
    op.execute("DROP TABLE question_units; DROP TABLE course_units;")
