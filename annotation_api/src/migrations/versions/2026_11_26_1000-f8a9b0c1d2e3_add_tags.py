"""Add tags, alert_tags, user_tags and users.full_access

Revision ID: f8a9b0c1d2e3
Revises: e7f8a9b0c1d2
Create Date: 2026-11-26 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "f8a9b0c1d2e3"
down_revision = "e7f8a9b0c1d2"
branch_labels = None
depends_on = None

# One migration for the whole tag schema (#402), so the alert-side and
# user-side work can land in parallel without two Alembic heads.


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "full_access", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )

    op.create_table(
        "tags",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_tag_name"),
    )

    op.create_table(
        "alert_tags",
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
        sa.Column("tag_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("source_api", "platform_alert_id", "tag_id"),
    )
    op.create_index("ix_alert_tag_tag_id", "alert_tags", ["tag_id"])

    op.create_table(
        "user_tags",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("tag_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "tag_id"),
    )
    op.create_index("ix_user_tag_tag_id", "user_tags", ["tag_id"])


def downgrade() -> None:
    op.drop_index("ix_user_tag_tag_id", table_name="user_tags")
    op.drop_table("user_tags")
    op.drop_index("ix_alert_tag_tag_id", table_name="alert_tags")
    op.drop_table("alert_tags")
    op.drop_table("tags")
    op.drop_column("users", "full_access")
