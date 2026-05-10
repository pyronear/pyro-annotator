"""add sequence_groups + sequences.sequence_group_id

Revision ID: b2c3d4e5f6a7
Revises: 063dc76c9846
Create Date: 2026-05-10 07:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sequence_groups",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("camera_id", sa.Integer(), nullable=False),
        sa.Column("azimuth", sa.Integer(), nullable=False),
        sa.Column(
            "representative_bbox",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("smoke_type", sa.Text(), nullable=True),
        sa.Column("false_positive_type", sa.Text(), nullable=True),
        sa.Column(
            "is_unsure",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("labeled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("labeled_by_user_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["labeled_by_user_id"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "(smoke_type IS NULL AND false_positive_type IS NULL) "
            "OR (smoke_type IS NOT NULL AND false_positive_type IS NULL) "
            "OR (smoke_type IS NULL AND false_positive_type IS NOT NULL)",
            name="ck_sequence_group_label_xor",
        ),
        sa.CheckConstraint(
            "(labeled_at IS NULL) = "
            "(smoke_type IS NULL AND false_positive_type IS NULL)",
            name="ck_sequence_group_labeled_at_consistency",
        ),
    )
    op.create_index(
        "ix_sequence_groups_camera_azimuth",
        "sequence_groups",
        ["camera_id", "azimuth"],
    )

    op.add_column(
        "sequences",
        sa.Column("sequence_group_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_sequences_sequence_group_id",
        "sequences",
        "sequence_groups",
        ["sequence_group_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_sequences_sequence_group_id",
        "sequences",
        ["sequence_group_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_sequences_sequence_group_id", table_name="sequences")
    op.drop_constraint(
        "fk_sequences_sequence_group_id", "sequences", type_="foreignkey"
    )
    op.drop_column("sequences", "sequence_group_id")
    op.drop_index("ix_sequence_groups_camera_azimuth", table_name="sequence_groups")
    op.drop_table("sequence_groups")
