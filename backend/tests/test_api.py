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

