"""Add desktop portfolio and rate-calibration state."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "portfolio_versions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_name", sa.String(length=255), nullable=False),
        sa.Column("positions_json", sa.JSON(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_portfolio_versions_is_default", "portfolio_versions", ["is_default"])
    op.create_index(
        "ix_portfolio_versions_default_archive",
        "portfolio_versions",
        ["is_default", "archived_at"],
    )
    op.create_table(
        "rate_calibrations",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("calibrated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_rate_calibrations_is_active", "rate_calibrations", ["is_active"])


def downgrade() -> None:
    op.drop_table("rate_calibrations")
    op.drop_table("portfolio_versions")
