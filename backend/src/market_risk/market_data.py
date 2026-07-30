import asyncio
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import Settings
from .models import MarketPrice

POLYGON_SOURCE = "Polygon.io adjusted daily aggregate and latest trade"
YFINANCE_SOURCE = "yfinance adjusted daily close"
PROXIES = {
    "UST2Y": "SHY",
    "UST5Y": "IEI",
    "UST10Y": "IEF",
    "UST20Y": "TLT",
}


@dataclass(frozen=True)
class FetchedSeries:
    observations: list[tuple[date, float]]
    latest_price_at: datetime | None = None


def source_symbol(symbol: str) -> str:
    normalized = symbol.strip().upper()
    if normalized in PROXIES:
        return PROXIES[normalized]
    if " " in normalized:
        return normalized.split(" ", maxsplit=1)[0]
    return normalized


async def fetch_polygon_series(
    symbol: str,
    api_key: str,
    years: int = 4,
) -> FetchedSeries:
    mapped = source_symbol(symbol)
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=years * 366)
    url = (
        f"https://api.polygon.io/v2/aggs/ticker/{mapped}/range/1/day/"
        f"{start.isoformat()}/{today.isoformat()}"
    )
    params = {
        "adjusted": "true",
        "sort": "asc",
        "limit": 50000,
        "apiKey": api_key,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        payload: dict[str, Any] = response.json()
        observations = [
            (
                datetime.fromtimestamp(item["t"] / 1000, tz=timezone.utc).date(),
                float(item["c"]),
            )
            for item in payload.get("results") or []
            if isinstance(item.get("t"), (int, float))
            and isinstance(item.get("c"), (int, float))
            and item["c"] > 0
        ]
        # A daily aggregate can lag an active session, so overlay Polygon's
        # latest trade when the caller's plan provides real-time access.
        latest_price_at = None
        latest = await client.get(
            f"https://api.polygon.io/v2/last/trade/{mapped}",
            params={"apiKey": api_key},
        )
        if latest.is_success:
            trade = latest.json().get("results") or {}
            price = trade.get("p")
            timestamp = trade.get("t")
            if isinstance(price, (int, float)) and price > 0:
                trade_date = (
                    datetime.fromtimestamp(timestamp / 1_000_000_000, tz=timezone.utc).date()
                    if isinstance(timestamp, (int, float))
                    else today
                )
                if isinstance(timestamp, (int, float)):
                    latest_price_at = datetime.fromtimestamp(
                        timestamp / 1_000_000_000,
                        tz=timezone.utc,
                    )
                if observations and observations[-1][0] == trade_date:
                    observations[-1] = (trade_date, float(price))
                else:
                    observations.append((trade_date, float(price)))
    if len(observations) < 2:
        raise ValueError(f"{mapped}: insufficient Polygon.io market history")
    return FetchedSeries(observations, latest_price_at)


def _fetch_yfinance_series_sync(symbol: str, years: int) -> FetchedSeries:
    import yfinance as yf

    mapped = source_symbol(symbol)
    cutoff = datetime.now(timezone.utc).date() - timedelta(days=years * 366)
    ticker = yf.Ticker(mapped)
    history = ticker.history(
        # yfinance only accepts predefined period values (including 2y and
        # 5y), not arbitrary values such as 4y. Fetch 5y and trim locally.
        period="5y",
        interval="1d",
        auto_adjust=True,
        actions=False,
        repair=False,
        timeout=20,
    )
    observations: list[tuple[date, float]] = []
    for timestamp, price in history.get("Close", []).items():
        if timestamp.date() >= cutoff and price > 0:
            observations.append((timestamp.date(), float(price)))
    if len(observations) < 2:
        raise ValueError(f"{mapped}: insufficient yfinance market history")
    quote_timestamp = ticker.history_metadata.get("regularMarketTime")
    latest_price_at = (
        datetime.fromtimestamp(quote_timestamp, tz=timezone.utc)
        if isinstance(quote_timestamp, (int, float))
        else None
    )
    return FetchedSeries(observations, latest_price_at)


async def fetch_yfinance_series(symbol: str, years: int = 4) -> FetchedSeries:
    return await asyncio.to_thread(_fetch_yfinance_series_sync, symbol, years)


async def fetch_market_series(
    symbol: str,
    settings: Settings,
) -> tuple[FetchedSeries, str]:
    try:
        return await fetch_yfinance_series(symbol), YFINANCE_SOURCE
    except Exception:
        # Provider failures are deliberately isolated per symbol.
        if settings.polygon_api_key:
            return (
                await fetch_polygon_series(symbol, settings.polygon_api_key),
                POLYGON_SOURCE,
            )
        raise


def read_series(session: Session, symbol: str) -> list[MarketPrice]:
    return list(
        session.scalars(
            select(MarketPrice)
            .where(MarketPrice.requested_symbol == symbol.strip().upper())
            .order_by(MarketPrice.trading_date),
        ),
    )


def is_fresh(session: Session, symbol: str, cache_hours: int) -> bool:
    newest = session.scalar(
        select(MarketPrice)
        .where(MarketPrice.requested_symbol == symbol.strip().upper())
        .order_by(
            MarketPrice.retrieved_at.desc(),
            MarketPrice.trading_date.desc(),
        )
        .limit(1),
    )
    if newest is None:
        return False
    # A cached backup-provider result must not prevent the preferred provider
    # from being retried after provider priority or entitlements change.
    if newest.source != YFINANCE_SOURCE:
        return False
    # Rows created before provider timestamps were persisted need one refresh
    # so the UI can replace a date-only label with the actual quote time.
    if newest.observed_at is None:
        return False
    retrieved_at = newest.retrieved_at
    if retrieved_at.tzinfo is None:
        retrieved_at = retrieved_at.replace(tzinfo=timezone.utc)
    return retrieved_at >= datetime.now(timezone.utc) - timedelta(hours=cache_hours)


async def load_series(
    session: Session,
    symbol: str,
    settings: Settings,
    force_refresh: bool = False,
) -> list[MarketPrice]:
    normalized = symbol.strip().upper()
    if not force_refresh and is_fresh(session, normalized, settings.market_data_cache_hours):
        return read_series(session, normalized)

    fetched, source = await fetch_market_series(normalized, settings)
    observations = fetched.observations
    retrieved_at = datetime.now(timezone.utc)
    session.execute(
        delete(MarketPrice).where(
            MarketPrice.requested_symbol == normalized,
        ),
    )
    session.add_all(
        MarketPrice(
            requested_symbol=normalized,
            source_symbol=source_symbol(normalized),
            trading_date=trading_date,
            adjusted_close=price,
            source=source,
            observed_at=(
                fetched.latest_price_at
                if trading_date == observations[-1][0]
                else None
            ),
            retrieved_at=retrieved_at,
        )
        for trading_date, price in observations
    )
    session.commit()
    return read_series(session, normalized)
