from fastapi.testclient import TestClient
from sqlalchemy import func, select

from market_risk.api import app
from market_risk.database import SessionLocal
from market_risk import desktop_api
from market_risk.models import RiskRun


def test_parses_market_briefing_quotes_and_headlines() -> None:
    quote = desktop_api.parse_market_indicator(
        "S&P 500",
        "^GSPC",
        "index",
        {
            "chart": {
                "result": [{
                    "meta": {
                        "regularMarketPrice": 6500,
                        "chartPreviousClose": 6450,
                        "regularMarketTime": 1784480400,
                        "marketState": "REGULAR",
                    },
                }],
            },
        },
    )
    assert quote["change"] == 50
    assert quote["percentChange"] == 50 / 6450
    assert quote["marketState"] == "REGULAR"

    headlines = desktop_api.parse_yahoo_headlines("""
        <rss><channel>
          <item><title>Markets &amp; rates</title><link>https://example.com/one</link><pubDate>Today</pubDate></item>
          <item><title>Second story</title><link>https://example.com/two</link></item>
        </channel></rss>
    """)
    assert headlines[0]["title"] == "Markets & rates"
    assert len(headlines) == 2


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


def test_saves_hull_white_and_g2_calibrations_independently(monkeypatch) -> None:
    async def fake_calibration(model: str) -> dict:
        return {
            "id": f"id-{model}",
            "model": model,
            "version": "1.1",
            "curveDate": "2026-07-19T00:00:00+00:00",
            "calibratedAt": "2026-07-19T12:00:00+00:00",
            "meanReversion": 0.1 if model == "G2++ 2F" else 0.03,
            "volatility": 0.01,
            "secondFactorMeanReversion": 0.3 if model == "G2++ 2F" else None,
            "secondFactorVolatility": 0.015 if model == "G2++ 2F" else None,
            "factorCorrelation": -0.7 if model == "G2++ 2F" else None,
            "parameterSource": "historical-calibration",
            "curveSource": "test",
            "curve": [
                {"maturity": 1, "yield": 0.04, "discountFactor": 0.96},
                {"maturity": 2, "yield": 0.041, "discountFactor": 0.92},
                {"maturity": 5, "yield": 0.043, "discountFactor": 0.81},
                {"maturity": 10, "yield": 0.045, "discountFactor": 0.64},
            ],
            "fitRmse": 0,
            "status": "valid",
        }

    monkeypatch.setattr(desktop_api, "treasury_calibration", fake_calibration)
    with TestClient(app) as client:
        hull_white = client.post("/api/v1/rates", params={"model": "Hull-White 1F"})
        g2 = client.post("/api/v1/rates", params={"model": "G2++ 2F"})
        assert hull_white.status_code == 200
        assert g2.status_code == 200
        assert hull_white.json()["calibration"]["model"] == "Hull-White 1F"
        assert g2.json()["calibration"]["model"] == "G2++ 2F"
        assert g2.json()["calibration"]["factorCorrelation"] == -0.7

        saved_hull_white = client.get("/api/v1/rates", params={"model": "Hull-White 1F"})
        saved_g2 = client.get("/api/v1/rates", params={"model": "G2++ 2F"})
        assert saved_hull_white.json()["calibration"]["id"] == "id-Hull-White 1F"
        assert saved_g2.json()["calibration"]["id"] == "id-G2++ 2F"


def test_estimates_bounded_g2_parameters_from_treasury_history() -> None:
    observations = []
    level = 4.0
    slope = 0.4
    for day in range(260):
        level = 4.0 + 0.97 * (level - 4.0) + 0.03 * ((day % 7) - 3)
        slope = 0.4 + 0.94 * (slope - 0.4) + 0.02 * ((day % 5) - 2)
        maturities = [-0.7, -0.5, -0.3, -0.15, 0, 0.15, 0.3, 0.45, 0.65, 0.75]
        curve = [level + slope * loading for loading in maturities]
        observations.append((f"2025-{day // 28 + 1:02d}-{day % 28 + 1:02d}", curve))

    result = desktop_api.estimate_g2_parameters(observations)

    assert result["observationCount"] == 260
    assert result["fallbackUsed"] is False
    assert 0.001 <= result["meanReversion"] <= 5.00
    assert 0.001 <= result["volatility"] <= 0.10
    assert 0.001 <= result["secondFactorMeanReversion"] <= 5.00
    assert 0.001 <= result["secondFactorVolatility"] <= 0.10
    assert -0.95 <= result["factorCorrelation"] <= 0.95
    assert result["fitRmse"] >= 0


def test_estimates_hull_white_parameters_from_treasury_history() -> None:
    observations = []
    level = 4.0
    for day in range(180):
        level = 4.0 + 0.96 * (level - 4.0) + 0.025 * ((day % 7) - 3)
        curve = [level + offset for offset in (-0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4)]
        observations.append((f"2025-{day // 28 + 1:02d}-{day % 28 + 1:02d}", curve))

    result = desktop_api.estimate_hull_white_parameters(observations)

    assert result["observationCount"] == 180
    assert result["fallbackUsed"] is False
    assert 0.001 <= result["meanReversion"] <= 5.00
    assert 0.001 <= result["volatility"] <= 0.10
    assert result["fitRmse"] >= 0
