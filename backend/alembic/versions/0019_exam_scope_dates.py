"""Optional dates on exam scopes, plus lab session and short quiz (blic) kinds."""

from sqlalchemy import text

from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
ALTER TABLE exam_scopes ADD COLUMN starts_on DATE;
ALTER TABLE exam_scopes ADD COLUMN ends_on DATE;
ALTER TABLE exam_scopes ADD CONSTRAINT ck_exam_scope_dates
    CHECK (ends_on IS NULL OR (starts_on IS NOT NULL AND ends_on >= starts_on));
ALTER TABLE exam_scopes DROP CONSTRAINT ck_exam_scope_kind;
ALTER TABLE exam_scopes ADD CONSTRAINT ck_exam_scope_kind
    CHECK (kind IN ('MIDTERM','FINAL','FULL_EXAM','LAB','QUIZ'));
""")


def downgrade() -> None:
    newer = op.get_bind().scalar(
        text("SELECT count(*) FROM exam_scopes WHERE kind IN ('LAB','QUIZ')")
    )
    if newer:
        raise RuntimeError("Cannot downgrade: lab or quiz exam scopes exist; delete them first")
    op.execute("""
ALTER TABLE exam_scopes DROP CONSTRAINT ck_exam_scope_kind;
ALTER TABLE exam_scopes ADD CONSTRAINT ck_exam_scope_kind
    CHECK (kind IN ('MIDTERM','FINAL','FULL_EXAM'));
ALTER TABLE exam_scopes DROP CONSTRAINT ck_exam_scope_dates;
ALTER TABLE exam_scopes DROP COLUMN ends_on;
ALTER TABLE exam_scopes DROP COLUMN starts_on;
""")
