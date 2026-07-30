import asyncio
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from market_risk.config import Settings
from market_risk.database import Base
from market_risk import market_data
from market_risk.market_data import load_series, source_symbol


def test_source_symbol_maps_options_and_treasury_proxy() -> None:
    assert source_symbol("AAPL C200") == "AAPL"
    assert source_symbol("UST2Y") == "SHY"
    assert source_symbol("UST10Y") == "IEF"
    assert source_symbol("UST20Y") == "TLT"
    assert source_symbol("spy") == "SPY"


def test_load_series_persists_reuses_cache_and_honors_force_refresh(monkeypatch) -> None:
    calls = 0

    async def fake_fetch(_: str, __: Settings):
        nonlocal calls
        calls += 1
        return (
            [
                (date(2026, 7, 17), 699.50),
                (date(2026, 7, 18), 701.25),
            ],
            market_data.YFINANCE_SOURCE,
        )

    monkeypatch.setattr(market_data, "fetch_market_series", fake_fetch)
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    settings = Settings(
        database_url="sqlite:///:memory:",
        market_data_cache_hours=6,
    )
    with Session(engine) as session:
        first = asyncio.run(load_series(session, "SPY", settings))
        second = asyncio.run(load_series(session, "SPY", settings))
        refreshed = asyncio.run(load_series(
            session,
            "SPY",
            settings,
            force_refresh=True,
        ))
        assert [row.adjusted_close for row in first] == [699.50, 701.25]
        assert [row.adjusted_close for row in second] == [699.50, 701.25]
        assert [row.adjusted_close for row in refreshed] == [699.50, 701.25]
        assert all(row.source == market_data.YFINANCE_SOURCE for row in refreshed)
        assert calls == 2
    engine.dispose()


def test_polygon_cache_does_not_block_yfinance_retry(monkeypatch) -> None:
    calls = 0

    async def fake_fetch(_: str, __: Settings):
        nonlocal calls
        calls += 1
        source = market_data.POLYGON_SOURCE if calls == 1 else market_data.YFINANCE_SOURCE
        return [(date(2026, 7, 17), 699.50), (date(2026, 7, 18), 701.25)], source

    monkeypatch.setattr(market_data, "fetch_market_series", fake_fetch)
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        first = asyncio.run(load_series(session, "SPY", Settings()))
        second = asyncio.run(load_series(session, "SPY", Settings()))
        assert first[-1].source == market_data.POLYGON_SOURCE
        assert second[-1].source == market_data.YFINANCE_SOURCE
        assert calls == 2
    engine.dispose()


def test_yfinance_failure_falls_back_to_polygon(monkeypatch) -> None:
    async def failed_yfinance(*_):
        raise RuntimeError("provider unavailable")

    async def fake_polygon(_: str, __: str):
        return [(date(2026, 7, 17), 699.50), (date(2026, 7, 18), 701.25)]

    monkeypatch.setattr(market_data, "fetch_yfinance_series", failed_yfinance)
    monkeypatch.setattr(market_data, "fetch_polygon_series", fake_polygon)
    observations, source = asyncio.run(market_data.fetch_market_series(
        "SPY",
        Settings(polygon_api_key="test-key"),
    ))
    assert observations[-1][1] == 701.25
    assert source == market_data.POLYGON_SOURCE


def test_yfinance_uses_supported_period_and_trims_to_requested_years(monkeypatch) -> None:
    import pandas as pd
    import yfinance

    requested: dict[str, object] = {}

    class FakeTicker:
        def __init__(self, symbol: str):
            requested["symbol"] = symbol

        def history(self, **kwargs):
            requested.update(kwargs)
            return pd.DataFrame(
                {"Close": [100.0, 101.0]},
                index=pd.to_datetime(["2026-07-17", "2026-07-18"]),
            )

    monkeypatch.setattr(yfinance, "Ticker", FakeTicker)
    observations = market_data._fetch_yfinance_series_sync("spy", years=4)
    assert requested["symbol"] == "SPY"
    assert requested["period"] == "5y"
    assert observations[-1] == (date(2026, 7, 18), 101.0)
