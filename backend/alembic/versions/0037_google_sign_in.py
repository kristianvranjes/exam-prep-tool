"""Google sign-in (#182): users carry their Google account id and a session cut-off."""

from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Both columns are empty for existing accounts: nobody is linked yet and every session stays.
    op.execute("""
ALTER TABLE users
    ADD COLUMN google_sub VARCHAR(255),
    ADD COLUMN sessions_valid_after TIMESTAMP WITH TIME ZONE,
    ADD CONSTRAINT uq_users_google_sub UNIQUE (google_sub);
""")


def downgrade() -> None:
    op.execute("""
ALTER TABLE users
    DROP CONSTRAINT uq_users_google_sub,
    DROP COLUMN sessions_valid_after,
    DROP COLUMN google_sub;
""")
