"""Add alert API connector, organization, and import coverage tables

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-08-11 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d6e7f8a9b0c1"
down_revision = "c5d6e7f8a9b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "alert_api_connectors",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("base_url", sa.String(length=255), nullable=False),
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
        sa.Column("login", sa.String(length=100), nullable=False),
        sa.Column("password_encrypted", sa.String(), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("trailing_days", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("image_transfer", sa.String(length=20), nullable=True),
        sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_verify_error", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("base_url", name="uq_connector_base_url"),
        sa.UniqueConstraint("source_api", name="uq_connector_source_api"),
    )

    op.create_table(
        "alert_api_connector_organizations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("connector_id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column(
            "is_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("enabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["connector_id"], ["alert_api_connectors.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("connector_id", "organization_id", name="uq_connector_org"),
    )

    op.create_table(
        "alert_api_import_coverage",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("connector_id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("covered_date", sa.Date(), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM("OK", "PARTIAL", "FAILED", name="importcoveragestatus"),
            nullable=False,
        ),
        sa.Column("alerts_fetched", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("alerts_imported", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("alerts_skipped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("alerts_failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lanes_created", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column(
            "last_attempt_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["connector_id"], ["alert_api_connectors.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "connector_id",
            "organization_id",
            "covered_date",
            name="uq_coverage_connector_org_date",
        ),
    )
    op.create_index(
        "ix_coverage_connector_date",
        "alert_api_import_coverage",
        ["connector_id", "covered_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_coverage_connector_date", table_name="alert_api_import_coverage")
    op.drop_table("alert_api_import_coverage")
    op.drop_table("alert_api_connector_organizations")
    op.drop_table("alert_api_connectors")
    sa.Enum(name="importcoveragestatus").drop(op.get_bind(), checkfirst=True)
