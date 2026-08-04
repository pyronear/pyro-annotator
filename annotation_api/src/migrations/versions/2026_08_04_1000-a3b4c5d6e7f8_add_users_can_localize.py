"""add users can_localize

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-08-04 10:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a3b4c5d6e7f8"
down_revision: Union[str, None] = "f2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "can_localize", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    # Grandfather existing human users: everyone active today already
    # localizes. The login-disabled worker user stays False.
    op.execute("UPDATE users SET can_localize = true WHERE is_active = true")


def downgrade() -> None:
    op.drop_column("users", "can_localize")
