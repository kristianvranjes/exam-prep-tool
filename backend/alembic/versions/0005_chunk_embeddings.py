"""Persist dense chunk embeddings and compatibility fingerprints."""

import sqlalchemy as sa
from pgvector.sqlalchemy import VECTOR

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column("material_chunks", sa.Column("embedding", VECTOR(1024), nullable=True))
    op.add_column(
        "material_chunks", sa.Column("embedding_content_hash", sa.String(64), nullable=True)
    )
    op.add_column("material_chunks", sa.Column("embedding_signature", sa.String(64), nullable=True))
    op.add_column(
        "material_chunks", sa.Column("embedded_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_check_constraint(
        "ck_chunk_embedding_complete",
        "material_chunks",
        "(embedding IS NULL AND embedding_content_hash IS NULL "
        "AND embedding_signature IS NULL AND embedded_at IS NULL) OR "
        "(embedding IS NOT NULL AND embedding_content_hash IS NOT NULL "
        "AND embedding_signature IS NOT NULL AND embedded_at IS NOT NULL "
        "AND length(embedding_content_hash) = 64 AND length(embedding_signature) = 64 "
        "AND vector_norm(embedding) > 0)",
    )
    # Exact search uses the existing material/course FK indexes; no ANN index yet.


def downgrade() -> None:
    op.drop_constraint("ck_chunk_embedding_complete", "material_chunks", type_="check")
    for name in ("embedded_at", "embedding_signature", "embedding_content_hash", "embedding"):
        op.drop_column("material_chunks", name)
    # The extension belongs to revision 0001 and may be used by other objects.
