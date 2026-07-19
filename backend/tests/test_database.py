from datetime import date, datetime, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from market_risk.database import Base
from market_risk.models import MarketPrice, RiskRun


def test_sqlite_schema_persists_prices_and_runs() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(
            MarketPrice(
                requested_symbol="SPY",
                source_symbol="SPY",
                trading_date=date(2026, 7, 17),
                adjusted_close=700.25,
                source="test",
                retrieved_at=datetime.now(timezone.utc),
            ),
        )
        session.add(
            RiskRun(
                model="historical",
                confidence=0.99,
                horizon_days=1,
                request_payload={"positions": []},
                result_payload={"var": 1},
                engine_version="test",
            ),
        )
        session.commit()
        assert session.scalar(select(MarketPrice.adjusted_close)) == 700.25
        assert session.scalar(select(RiskRun.model)) == "historical"
    engine.dispose()

