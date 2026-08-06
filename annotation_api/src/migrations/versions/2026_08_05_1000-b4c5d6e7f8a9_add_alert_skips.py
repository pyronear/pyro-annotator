"""Add alert_skips overlay table

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-08-05 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b4c5d6e7f8a9"
down_revision = "a3b4c5d6e7f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "alert_skips",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "source_api",
            postgresql.ENUM(
                "PYRONEAR_FRENCH_API",
                "ALERT_WILDFIRE",
                "CENIA",
                name="sourceapi",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("platform_alert_id", sa.BigInteger(), nullable=False),
        sa.Column("skipped_by_user_id", sa.Integer(), nullable=True),
        sa.Column(
            "skipped_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["skipped_by_user_id"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_api", "platform_alert_id", name="uq_alert_skip_alert"
        ),
    )


def downgrade() -> None:
    op.drop_table("alert_skips")
