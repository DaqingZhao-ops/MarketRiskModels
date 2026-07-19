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
    assert source_symbol("UST10Y") == "TLT"
    assert source_symbol("spy") == "SPY"


def test_load_series_persists_and_reuses_fresh_history(monkeypatch) -> None:
    calls = 0

    async def fake_fetch(_: str):
        nonlocal calls
        calls += 1
        return [
            (date(2026, 7, 17), 699.50),
            (date(2026, 7, 18), 701.25),
        ]

    monkeypatch.setattr(market_data, "fetch_yahoo_series", fake_fetch)
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    settings = Settings(
        database_url="sqlite:///:memory:",
        market_data_cache_hours=6,
    )
    with Session(engine) as session:
        first = asyncio.run(load_series(session, "SPY", settings))
        second = asyncio.run(load_series(session, "SPY", settings))
        assert [row.adjusted_close for row in first] == [699.50, 701.25]
        assert [row.adjusted_close for row in second] == [699.50, 701.25]
        assert calls == 1
    engine.dispose()
