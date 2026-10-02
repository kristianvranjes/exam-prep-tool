"""Durable material-source cleanup intents, independent of deleted domain rows."""

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE material_storage_cleanups (
    id UUID PRIMARY KEY,
    storage_key VARCHAR(100) NOT NULL UNIQUE,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_material_storage_cleanup_attempts CHECK (attempt_count >= 0)
);
CREATE INDEX ix_material_storage_cleanups_queue ON material_storage_cleanups(created_at, id);
""")


def downgrade() -> None:
    # Operators must drain/inspect pending intents before intentionally losing them.
    op.execute("DROP TABLE material_storage_cleanups")
