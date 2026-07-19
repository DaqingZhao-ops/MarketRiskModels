from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .config import Settings
from .models import MarketPrice

SOURCE = "Yahoo Finance adjusted daily close"
PROXIES = {
    "UST2Y": "SHY",
    "UST5Y": "IEI",
    "UST10Y": "IEF",
    "UST20Y": "TLT",
}


def source_symbol(symbol: str) -> str:
    normalized = symbol.strip().upper()
    if normalized in PROXIES:
        return PROXIES[normalized]
    if " " in normalized:
        return normalized.split(" ", maxsplit=1)[0]
    return normalized


async def fetch_yahoo_series(symbol: str, years: int = 4) -> list[tuple[date, float]]:
    mapped = source_symbol(symbol)
    period2 = int(datetime.now(timezone.utc).timestamp()) + 86_400
    period1 = period2 - years * 366 * 86_400
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{mapped}"
    params = {
        "period1": period1,
        "period2": period2,
        "interval": "1d",
        "events": "div,splits",
        "includeAdjustedClose": "true",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(
            url,
            params=params,
            headers={"User-Agent": "Mozilla/5.0 MarketRiskModels/2.0"},
        )
        response.raise_for_status()
    payload: dict[str, Any] = response.json()
    result = (payload.get("chart", {}).get("result") or [None])[0]
    if not result:
        message = payload.get("chart", {}).get("error", {}).get("description", "no data")
        raise ValueError(f"{mapped}: {message}")
    timestamps = result.get("timestamp") or []
    indicators = result.get("indicators", {})
    adjusted = ((indicators.get("adjclose") or [{}])[0].get("adjclose") or [])
    closes = ((indicators.get("quote") or [{}])[0].get("close") or [])
    prices = adjusted or closes
    observations: list[tuple[date, float]] = []
    for timestamp, price in zip(timestamps, prices, strict=False):
        if isinstance(price, (int, float)) and price > 0:
            trading_date = datetime.fromtimestamp(timestamp, tz=timezone.utc).date()
            observations.append((trading_date, float(price)))
    if len(observations) < 2:
        raise ValueError(f"{mapped}: insufficient market history")
    return observations


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
        select(func.max(MarketPrice.retrieved_at)).where(
            MarketPrice.requested_symbol == symbol.strip().upper(),
        ),
    )
    if newest is None:
        return False
    if newest.tzinfo is None:
        newest = newest.replace(tzinfo=timezone.utc)
    return newest >= datetime.now(timezone.utc) - timedelta(hours=cache_hours)


async def load_series(
    session: Session,
    symbol: str,
    settings: Settings,
    force_refresh: bool = False,
) -> list[MarketPrice]:
    normalized = symbol.strip().upper()
    if not force_refresh and is_fresh(session, normalized, settings.market_data_cache_hours):
        return read_series(session, normalized)

    observations = await fetch_yahoo_series(normalized)
    retrieved_at = datetime.now(timezone.utc)
    session.execute(
        delete(MarketPrice).where(
            MarketPrice.requested_symbol == normalized,
            MarketPrice.source == SOURCE,
        ),
    )
    session.add_all(
        MarketPrice(
            requested_symbol=normalized,
            source_symbol=source_symbol(normalized),
            trading_date=trading_date,
            adjusted_close=price,
            source=SOURCE,
            retrieved_at=retrieved_at,
        )
        for trading_date, price in observations
    )
    session.commit()
    return read_series(session, normalized)
