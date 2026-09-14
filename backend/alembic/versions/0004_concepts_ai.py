"""Add draft concepts, chunk provenance, AI jobs and usage."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "concepts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "course_id", sa.Uuid(), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("normalized_name", sa.String(600), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("aliases", JSONB(), nullable=False),
        sa.Column("importance", sa.String(10), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("created_by", sa.String(10), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("course_id", "normalized_name", name="uq_concept_course_name"),
        sa.CheckConstraint("status IN ('DRAFT','APPROVED','REJECTED')", name="ck_concept_status"),
        sa.CheckConstraint("created_by IN ('AI','USER')", name="ck_concept_creator"),
        sa.CheckConstraint("importance IN ('LOW','MEDIUM','HIGH')", name="ck_concept_importance"),
    )
    op.create_table(
        "concept_chunks",
        sa.Column(
            "concept_id",
            sa.Uuid(),
            sa.ForeignKey("concepts.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "material_chunk_id",
            sa.Uuid(),
            sa.ForeignKey("material_chunks.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_table(
        "ai_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "course_id", sa.Uuid(), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "material_id",
            sa.Uuid(),
            sa.ForeignKey("materials.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "requested_by_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("operation", sa.String(50), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("prompt_version", sa.String(50), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error_message", sa.String(300), nullable=True),
        sa.Column("error_code", sa.String(50), nullable=True),
        sa.Column("input_chunk_count", sa.Integer(), nullable=False),
        sa.Column("input_char_count", sa.Integer(), nullable=False),
        sa.Column("input_chunk_ids", JSONB(), nullable=False),
        sa.Column("batch_count", sa.Integer(), nullable=False),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "status IN ('PENDING','RUNNING','SUCCEEDED','FAILED')", name="ck_ai_job_status"
        ),
    )
    op.create_table(
        "ai_usage",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "ai_job_id", sa.Uuid(), sa.ForeignKey("ai_jobs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("batch_ordinal", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("estimated_cost", sa.Numeric(12, 6), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("ai_job_id", "batch_ordinal", name="uq_usage_job_batch"),
    )
    op.create_index("ix_concepts_course_id", "concepts", ["course_id"])
    op.create_index("ix_concept_chunks_concept_id", "concept_chunks", ["concept_id"])
    op.create_index("ix_concept_chunks_material_chunk_id", "concept_chunks", ["material_chunk_id"])
    op.create_index("ix_ai_jobs_course_id", "ai_jobs", ["course_id"])
    op.create_index("ix_ai_jobs_material_id", "ai_jobs", ["material_id"])
    op.create_index("ix_ai_usage_ai_job_id", "ai_usage", ["ai_job_id"])
    op.create_index(
        "uq_ai_job_active_course",
        "ai_jobs",
        ["course_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('PENDING','RUNNING')"),
    )


def downgrade() -> None:
    op.drop_table("ai_usage")
    op.drop_table("ai_jobs")
    op.drop_table("concept_chunks")
    op.drop_table("concepts")
