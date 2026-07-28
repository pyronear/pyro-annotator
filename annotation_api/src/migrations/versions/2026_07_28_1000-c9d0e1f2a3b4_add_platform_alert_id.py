"""add platform_alert_id + auto-annotate timestamps to sequences

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-07-28
"""

from typing import Sequence as TypingSequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, TypingSequence[str], None] = None
depends_on: Union[str, TypingSequence[str], None] = None

# Mirrors app/services/alert_identity.py (and object_split.py). Backfill is
# existence-checked: only decode when the primary row exists under the same
# source — YOLO crc32 ids can exceed 1e9 without being synthetic. source_api
# stores enum NAMES (see the initial migration's sa.Enum definition).
BACKFILL = """
UPDATE sequences s
SET platform_alert_id = CASE
  WHEN s.source_api IN ('PYRONEAR_FRENCH_API', 'CENIA')
       AND s.alert_api_id >= 1000000000
       AND EXISTS (
         SELECT 1 FROM sequences p
         WHERE p.source_api = s.source_api
           AND p.alert_api_id = (s.alert_api_id - 1000000000) / 1000
       )
    THEN (s.alert_api_id - 1000000000) / 1000
  ELSE s.alert_api_id
END
"""


def upgrade() -> None:
    op.add_column(
        "sequences", sa.Column("platform_alert_id", sa.BigInteger(), nullable=True)
    )
    op.add_column(
        "sequences",
        sa.Column(
            "auto_annotate_enqueued_at", sa.DateTime(timezone=True), nullable=True
        ),
    )
    op.add_column(
        "sequences",
        sa.Column("auto_annotated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(BACKFILL)
    op.alter_column("sequences", "platform_alert_id", nullable=False)
    op.create_index(
        "ix_sequence_platform_alert_id",
        "sequences",
        ["source_api", "platform_alert_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_sequence_platform_alert_id", table_name="sequences")
    op.drop_column("sequences", "auto_annotated_at")
    op.drop_column("sequences", "auto_annotate_enqueued_at")
    op.drop_column("sequences", "platform_alert_id")
