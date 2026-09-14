"""Add materials and deterministic sections/chunks."""

import sqlalchemy as sa

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "materials",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "course_id", sa.Uuid(), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "uploaded_by_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("media_type", sa.String(100), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(100), nullable=False, unique=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("extracted_markdown", sa.Text()),
        sa.Column("processing_error", sa.String(300)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "status IN ('UPLOADED','PROCESSING','READY','FAILED')", name="ck_material_status"
        ),
        sa.CheckConstraint("file_size_bytes > 0", name="ck_material_size"),
    )
    for column in ("course_id", "uploaded_by_user_id", "status"):
        op.create_index(f"ix_materials_{column}", "materials", [column])
    op.create_table(
        "material_sections",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "material_id",
            sa.Uuid(),
            sa.ForeignKey("materials.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text()),
        sa.Column("level", sa.Integer()),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("material_id", "ordinal", name="uq_material_section_ordinal"),
        sa.CheckConstraint("ordinal >= 0", name="ck_section_ordinal"),
        sa.CheckConstraint("level IS NULL OR level BETWEEN 1 AND 6", name="ck_section_level"),
    )
    op.create_index("ix_material_sections_material_id", "material_sections", ["material_id"])
    op.create_table(
        "material_chunks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "material_id",
            sa.Uuid(),
            sa.ForeignKey("materials.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "section_id", sa.Uuid(), sa.ForeignKey("material_sections.id", ondelete="CASCADE")
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("char_count", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("material_id", "ordinal", name="uq_material_chunk_ordinal"),
        sa.CheckConstraint("ordinal >= 0", name="ck_chunk_ordinal"),
        sa.CheckConstraint(
            "char_count > 0 AND char_count = char_length(content)", name="ck_chunk_length"
        ),
    )
    op.create_index("ix_material_chunks_material_id", "material_chunks", ["material_id"])


def downgrade() -> None:
    op.drop_table("material_chunks")
    op.drop_table("material_sections")
    op.drop_table("materials")
