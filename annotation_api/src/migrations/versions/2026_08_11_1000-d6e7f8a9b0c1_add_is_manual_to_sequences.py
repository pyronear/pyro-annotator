"""Add is_manual to sequences

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-08-11 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "d6e7f8a9b0c1"
down_revision = "c5d6e7f8a9b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sequences",
        sa.Column("is_manual", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # No backfill. Lanes added by the pre-#312 add-object UI are
    # indistinguishable from importer-split siblings (same synthetic
    # alert_api_id formula), so they stay False and therefore undeletable —
    # the safe direction to fail.
    op.execute(
        "COMMENT ON COLUMN sequences.is_manual IS "
        "'True only for lanes a human added via POST /sequences/alert/add-object. "
        "Gates DELETE /sequences/{id}; imported lanes are refused.'"
    )


def downgrade() -> None:
    op.drop_column("sequences", "is_manual")
