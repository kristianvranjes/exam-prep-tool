"""Exam scopes per academic year and the practice focus recorded on quizzes."""

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE exam_scopes (
    id UUID PRIMARY KEY,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    academic_year VARCHAR(7) NOT NULL,
    kind VARCHAR(10) NOT NULL,
    name VARCHAR(100) NOT NULL,
    normalized_name VARCHAR(400) NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_exam_scope_year_name UNIQUE (course_id, academic_year, normalized_name),
    CONSTRAINT ck_exam_scope_kind CHECK (kind IN ('MIDTERM','FINAL','FULL_EXAM')),
    CONSTRAINT ck_exam_scope_academic_year CHECK (academic_year ~ '^[0-9]{4}/[0-9]{2}$'),
    CONSTRAINT ck_exam_scope_name CHECK (length(btrim(name)) > 0 AND char_length(name) <= 100)
);
CREATE INDEX ix_exam_scopes_course_id ON exam_scopes(course_id);
CREATE TABLE exam_scope_units (
    scope_id UUID NOT NULL REFERENCES exam_scopes(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES course_units(id) ON DELETE CASCADE,
    PRIMARY KEY (scope_id, unit_id)
);
CREATE INDEX ix_exam_scope_units_unit_id ON exam_scope_units(unit_id);
ALTER TABLE quizzes ADD COLUMN exam_scope_id UUID REFERENCES exam_scopes(id) ON DELETE SET NULL;
ALTER TABLE quizzes ADD COLUMN focus_unit_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE quizzes ADD COLUMN focus_label VARCHAR(300);
CREATE INDEX ix_quizzes_exam_scope_id ON quizzes(exam_scope_id);
""")


def downgrade() -> None:
    op.execute("""
DROP INDEX ix_quizzes_exam_scope_id;
ALTER TABLE quizzes DROP COLUMN focus_label;
ALTER TABLE quizzes DROP COLUMN focus_unit_ids;
ALTER TABLE quizzes DROP COLUMN exam_scope_id;
DROP TABLE exam_scope_units;
DROP TABLE exam_scopes;
""")
