"""add sequence_groups validation attribution

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-08-03 14:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sequence_groups",
        sa.Column("validated_by_user_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "sequence_groups",
        sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_sequence_groups_validated_by_user_id_users",
        "sequence_groups",
        "users",
        ["validated_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_sequence_groups_validated_by_user_id_users",
        "sequence_groups",
        type_="foreignkey",
    )
    op.drop_column("sequence_groups", "validated_at")
    op.drop_column("sequence_groups", "validated_by_user_id")
