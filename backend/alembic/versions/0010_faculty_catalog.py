"""Faculty hierarchy and enrollment availability without rebuilding course data."""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE faculties (
    id UUID PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    university_name VARCHAR(200),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_faculty_name CHECK (length(btrim(name)) > 0),
    CONSTRAINT ck_faculty_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
INSERT INTO faculties (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000010', 'Legacy / Unassigned', 'legacy-unassigned');
ALTER TABLE courses ADD COLUMN faculty_id UUID;
UPDATE courses SET faculty_id = '00000000-0000-0000-0000-000000000010';
ALTER TABLE courses ALTER COLUMN faculty_id SET NOT NULL;
ALTER TABLE courses ADD CONSTRAINT courses_faculty_id_fkey
    FOREIGN KEY (faculty_id) REFERENCES faculties(id) ON DELETE RESTRICT;
CREATE INDEX ix_courses_faculty_id ON courses(faculty_id);
ALTER TABLE courses ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
""")


def downgrade() -> None:
    # Keep every course and child row. Only the new hierarchy/availability is removed.
    op.execute("""
ALTER TABLE courses DROP COLUMN is_active;
ALTER TABLE courses DROP COLUMN faculty_id;
DROP TABLE faculties;
""")
