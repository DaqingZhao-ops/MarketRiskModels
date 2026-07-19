from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, Float, Index, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class MarketPrice(Base):
    __tablename__ = "market_prices"
    __table_args__ = (
        UniqueConstraint(
            "requested_symbol",
            "trading_date",
            "source",
            name="uq_market_price_symbol_date_source",
        ),
        Index("ix_market_prices_source_symbol_date", "source_symbol", "trading_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    requested_symbol: Mapped[str] = mapped_column(String(64), index=True)
    source_symbol: Mapped[str] = mapped_column(String(64), index=True)
    trading_date: Mapped[date] = mapped_column(Date, index=True)
    adjusted_close: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(80), default="Yahoo Finance")
    retrieved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        index=True,
    )


class RiskRun(Base):
    __tablename__ = "risk_runs"
    __table_args__ = (Index("ix_risk_runs_created_model", "created_at", "model"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        index=True,
    )
    model: Mapped[str] = mapped_column(String(32), index=True)
    confidence: Mapped[float] = mapped_column(Float)
    horizon_days: Mapped[int]
    request_payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    result_payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    engine_version: Mapped[str] = mapped_column(String(32))


class PortfolioVersion(Base):
    __tablename__ = "portfolio_versions"
    __table_args__ = (Index("ix_portfolio_versions_default_archive", "is_default", "archived_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_name: Mapped[str] = mapped_column(String(255), default="Saved portfolio")
    positions_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, index=True)


class RateCalibration(Base):
    __tablename__ = "rate_calibrations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    calibrated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
