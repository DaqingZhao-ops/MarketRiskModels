from datetime import date, datetime, timezone

from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session

from market_risk.database import Base, upgrade_sqlite_schema
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


def test_upgrades_legacy_desktop_database_without_alembic_version(tmp_path) -> None:
    database_path = tmp_path / "legacy.db"
    database_url = f"sqlite:///{database_path}"
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE market_prices (
                id INTEGER PRIMARY KEY,
                requested_symbol VARCHAR(64) NOT NULL,
                source_symbol VARCHAR(64) NOT NULL,
                trading_date DATE NOT NULL,
                adjusted_close FLOAT NOT NULL,
                source VARCHAR(80) NOT NULL,
                retrieved_at DATETIME NOT NULL
            )
        """))
        connection.execute(text("""
            CREATE TABLE portfolio_versions (
                id VARCHAR(36) PRIMARY KEY
            )
        """))

    upgrade_sqlite_schema(engine, database_url)

    columns = {column["name"] for column in inspect(engine).get_columns("market_prices")}
    assert "observed_at" in columns
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0003"
    engine.dispose()
