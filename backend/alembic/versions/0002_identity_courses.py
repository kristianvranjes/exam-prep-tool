"""Add users, courses and course memberships."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    user_id = postgresql.UUID(as_uuid=True)
    op.create_table(
        "users",
        sa.Column("id", user_id, primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=512), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_table(
        "courses",
        sa.Column("id", user_id, primary_key=True),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", user_id, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_courses_created_by_user_id", "courses", ["created_by_user_id"])
    op.create_table(
        "course_memberships",
        sa.Column("id", user_id, primary_key=True),
        sa.Column("course_id", user_id, nullable=False),
        sa.Column("user_id", user_id, nullable=False),
        sa.Column("role", sa.String(length=10), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("course_id", "user_id", name="uq_course_membership_course_user"),
        sa.CheckConstraint("role IN ('OWNER', 'MEMBER')", name="ck_course_membership_role"),
    )
    op.create_index("ix_course_memberships_course_id", "course_memberships", ["course_id"])
    op.create_index("ix_course_memberships_user_id", "course_memberships", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_course_memberships_user_id", table_name="course_memberships")
    op.drop_index("ix_course_memberships_course_id", table_name="course_memberships")
    op.drop_table("course_memberships")
    op.drop_index("ix_courses_created_by_user_id", table_name="courses")
    op.drop_table("courses")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
