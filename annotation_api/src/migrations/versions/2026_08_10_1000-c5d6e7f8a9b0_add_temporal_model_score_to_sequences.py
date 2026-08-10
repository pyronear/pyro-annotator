"""Add platform temporal model score to sequences

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-08-10 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "c5d6e7f8a9b0"
down_revision = "b4c5d6e7f8a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sequences", sa.Column("temporal_model_score", sa.Float(), nullable=True)
    )
    op.add_column(
        "sequences",
        sa.Column("temporal_model_version", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "sequences",
        sa.Column("temporal_api_version", sa.String(length=32), nullable=True),
    )
    op.create_index(
        "ix_sequence_temporal_model_score", "sequences", ["temporal_model_score"]
    )
    # No backfill: existing rows predate capture and were genuinely never
    # scored by this pipeline, which is exactly what NULL means here.
    op.execute(
        "COMMENT ON COLUMN sequences.temporal_model_score IS "
        "'Alert-API temporal-model smoke probability for this object. "
        "NULL = never scored (not scored low); never coalesce to 0.0.'"
    )


def downgrade() -> None:
    op.drop_index("ix_sequence_temporal_model_score", table_name="sequences")
    op.drop_column("sequences", "temporal_api_version")
    op.drop_column("sequences", "temporal_model_version")
    op.drop_column("sequences", "temporal_model_score")
