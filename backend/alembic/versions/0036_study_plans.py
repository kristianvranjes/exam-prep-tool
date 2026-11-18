"""Study plan settings per student and course (#173); the plan itself is computed."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "study_plans",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("course_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("exam_scope_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("target_points", sa.Numeric(6, 2), nullable=True),
        sa.Column("daily_minutes", sa.Integer(), nullable=False),
        sa.Column("plan_enabled", sa.Boolean(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("daily_minutes BETWEEN 10 AND 240", name="ck_study_plan_minutes"),
        sa.CheckConstraint(
            "target_points IS NULL OR (target_points > 0 AND target_points <= 1000)",
            name="ck_study_plan_target",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["exam_scope_id"], ["exam_scopes.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("user_id", "course_id"),
    )


def downgrade() -> None:
    op.drop_table("study_plans")
