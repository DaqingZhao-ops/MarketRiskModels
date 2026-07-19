from fastapi.testclient import TestClient
from sqlalchemy import func, select

from market_risk.api import app
from market_risk.database import SessionLocal
from market_risk.models import RiskRun


def test_health_and_parametric_risk_are_audited() -> None:
    request = {
        "positions": [
            {
                "id": "1",
                "symbol": "SPY",
                "type": "ETF",
                "marketValue": 100000,
                "volatility": 0.18,
                "beta": 1,
                "delta": 1,
            },
        ],
        "model": "parametric",
        "confidence": 0.99,
        "horizon": 1,
    }
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["engine"] == "Python"

        response = client.post("/api/v1/risk/calculate", json=request)
        assert response.status_code == 200
        payload = response.json()
        assert payload["engine"] == "Python"
        assert payload["runId"] >= 1
        assert payload["var"] > 0

    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(RiskRun)) == 1


def test_rejects_unsupported_horizon() -> None:
    request = {
        "positions": [
            {
                "id": "1",
                "symbol": "SPY",
                "type": "ETF",
                "marketValue": 100000,
                "volatility": 0.18,
                "beta": 1,
                "delta": 1,
            },
        ],
        "model": "parametric",
        "confidence": 0.99,
        "horizon": 3,
    }
    with TestClient(app) as client:
        response = client.post("/api/v1/risk/calculate", json=request)
    assert response.status_code == 422


def test_desktop_portfolio_api_versions_and_updates_default() -> None:
    first = [{
        "id": "a",
        "symbol": "AAPL",
        "type": "Stock",
        "quantity": 10,
        "price": 200,
        "multiplier": 1,
        "marketValue": 2000,
        "volatility": 0.25,
        "beta": 1.1,
        "delta": 1,
        "riskSource": "historical",
    }]
    updated = [{**first[0], "volatility": 0.31}]
    with TestClient(app) as client:
        created = client.post("/api/v1/portfolios", json={
            "positions": first,
            "sourceName": "schwab.csv",
        })
        assert created.status_code == 200
        assert created.json()["versions"][0]["sourceName"] == "schwab.csv"
        assert created.json()["versions"][0]["isDefault"] is True

        persisted = client.put("/api/v1/portfolios", json={"positions": updated})
        assert persisted.status_code == 200
        assert persisted.json()["versions"][0]["positions"][0]["volatility"] == 0.31

        listed = client.get("/api/v1/portfolios")
        assert listed.status_code == 200
        assert len(listed.json()["versions"]) == 1
