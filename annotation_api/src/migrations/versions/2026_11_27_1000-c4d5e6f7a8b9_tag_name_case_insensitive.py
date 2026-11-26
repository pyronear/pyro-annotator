"""Make tag names unique whatever their case

Revision ID: c4d5e6f7a8b9
Revises: a9b0c1d2e3f4
Create Date: 2026-11-27 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "c4d5e6f7a8b9"
down_revision = "a9b0c1d2e3f4"
branch_labels = None
depends_on = None

# "Org-A" and "org-a" are the same tag for the admins who type them: the
# unique constraint on name becomes a unique index on lower(name).


def upgrade() -> None:
    op.drop_constraint("uq_tag_name", "tags", type_="unique")
    op.create_index("uq_tag_name_lower", "tags", [sa.text("lower(name)")], unique=True)


def downgrade() -> None:
    op.drop_index("uq_tag_name_lower", table_name="tags")
    op.create_unique_constraint("uq_tag_name", "tags", ["name"])
