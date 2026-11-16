"""Record who added a faculty; faculty moderators can now add faculties."""

from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A separate table rather than a column on faculties: removing an account sets the
    # creator to NULL here and never touches the faculty itself.
    op.execute("""
CREATE TABLE faculty_creators (
    faculty_id UUID PRIMARY KEY REFERENCES faculties (id) ON DELETE CASCADE,
    user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_faculty_creators_user_id ON faculty_creators (user_id);
""")


def downgrade() -> None:
    # Faculties stay; only the record of who added them is dropped.
    op.execute("DROP TABLE faculty_creators;")
