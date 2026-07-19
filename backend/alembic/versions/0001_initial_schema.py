"""Initial market data and risk run schema."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "market_prices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("requested_symbol", sa.String(length=64), nullable=False),
        sa.Column("source_symbol", sa.String(length=64), nullable=False),
        sa.Column("trading_date", sa.Date(), nullable=False),
        sa.Column("adjusted_close", sa.Float(), nullable=False),
        sa.Column("source", sa.String(length=80), nullable=False),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "requested_symbol",
            "trading_date",
            "source",
            name="uq_market_price_symbol_date_source",
        ),
    )
    op.create_index("ix_market_prices_requested_symbol", "market_prices", ["requested_symbol"])
    op.create_index("ix_market_prices_source_symbol", "market_prices", ["source_symbol"])
    op.create_index("ix_market_prices_trading_date", "market_prices", ["trading_date"])
    op.create_index("ix_market_prices_retrieved_at", "market_prices", ["retrieved_at"])
    op.create_index(
        "ix_market_prices_source_symbol_date",
        "market_prices",
        ["source_symbol", "trading_date"],
    )
    op.create_table(
        "risk_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("model", sa.String(length=32), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("horizon_days", sa.Integer(), nullable=False),
        sa.Column("request_payload", sa.JSON(), nullable=False),
        sa.Column("result_payload", sa.JSON(), nullable=False),
        sa.Column("engine_version", sa.String(length=32), nullable=False),
    )
    op.create_index("ix_risk_runs_created_at", "risk_runs", ["created_at"])
    op.create_index("ix_risk_runs_model", "risk_runs", ["model"])
    op.create_index("ix_risk_runs_created_model", "risk_runs", ["created_at", "model"])


def downgrade() -> None:
    op.drop_table("risk_runs")
    op.drop_table("market_prices")

