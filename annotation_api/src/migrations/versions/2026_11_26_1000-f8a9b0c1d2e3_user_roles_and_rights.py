"""User role and per-right status

Replaces users.is_superuser and users.can_localize with a single role and one
status per annotation right (see
docs/specs/2026-11-26-user-roles-and-rights-design.md).

Revision ID: f8a9b0c1d2e3
Revises: e7f8a9b0c1d2
Create Date: 2026-11-26 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "f8a9b0c1d2e3"
down_revision = "e7f8a9b0c1d2"
branch_labels = None
depends_on = None

user_role = sa.Enum("ANNOTATOR", "ANNOTATION_MANAGER", "ADMIN", name="userrole")
right_status = sa.Enum("LOCKED", "TRAINING", "GRANTED", name="rightstatus")


def upgrade() -> None:
    bind = op.get_bind()
    user_role.create(bind, checkfirst=True)
    right_status.create(bind, checkfirst=True)

    op.add_column(
        "users",
        sa.Column("role", user_role, nullable=False, server_default="ANNOTATOR"),
    )
    op.add_column(
        "users",
        sa.Column(
            "classify_status", right_status, nullable=False, server_default="TRAINING"
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "localize_status", right_status, nullable=False, server_default="LOCKED"
        ),
    )
    op.add_column("users", sa.Column("external_id", sa.String(255), nullable=True))
    op.create_unique_constraint("uq_user_external_id", "users", ["external_id"])

    # Every existing account already classifies today; localize keeps its
    # current grant.
    op.execute(
        """
        UPDATE users SET
          role = CASE WHEN is_superuser THEN 'ADMIN'::userrole
                      ELSE 'ANNOTATOR'::userrole END,
          classify_status = 'GRANTED'::rightstatus,
          localize_status = CASE WHEN can_localize THEN 'GRANTED'::rightstatus
                                 ELSE 'LOCKED'::rightstatus END
        """
    )

    # The defaults live in the model; the server defaults only filled the
    # existing rows.
    op.alter_column("users", "role", server_default=None)
    op.alter_column("users", "classify_status", server_default=None)
    op.alter_column("users", "localize_status", server_default=None)

    op.drop_column("users", "is_superuser")
    op.drop_column("users", "can_localize")


def downgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "is_superuser", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "can_localize", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.execute(
        """
        UPDATE users SET
          is_superuser = (role = 'ADMIN'),
          can_localize = (localize_status = 'GRANTED')
        """
    )

    op.drop_constraint("uq_user_external_id", "users", type_="unique")
    op.drop_column("users", "external_id")
    op.drop_column("users", "localize_status")
    op.drop_column("users", "classify_status")
    op.drop_column("users", "role")

    bind = op.get_bind()
    right_status.drop(bind, checkfirst=True)
    user_role.drop(bind, checkfirst=True)
