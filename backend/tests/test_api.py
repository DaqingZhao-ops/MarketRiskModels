from fastapi.testclient import TestClient
from sqlalchemy import func, select

from market_risk.api import app
from market_risk.database import SessionLocal
from market_risk import desktop_api
from market_risk.models import RiskRun


def test_parses_market_briefing_quotes_and_headlines() -> None:
    assert [
        ("Nasdaq Composite", "^IXIC", "index"),
        ("CBOE Volatility Index", "^VIX", "index"),
        ("Nikkei 225", "^N225", "index"),
        ("FTSE 100", "^FTSE", "index"),
        ("DAX", "^GDAXI", "index"),
        ("Hang Seng", "^HSI", "index"),
        ("Shanghai Composite", "000001.SS", "index"),
    ] == desktop_api.MARKET_INDICATORS[2:9]
    assert desktop_api.INDEX_FUTURES == {
        "^GSPC": ("S&P 500 Futures", "ES=F"),
        "^DJI": ("Dow Futures", "YM=F"),
        "^N225": ("Nikkei 225 Futures", "NKD=F"),
    }

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
                    "indicators": {"quote": [{"close": [6400, None, 6450, 6500]}]},
                }],
            },
        },
    )
    assert quote["previousClose"] == 6450
    assert quote["change"] == 50
    assert quote["percentChange"] == 50 / 6450
    assert quote["marketState"] == "REGULAR"
    assert quote["trend"] == [6400, 6450, 6500]

    shanghai = desktop_api.parse_market_indicator(
        "Shanghai Composite",
        "000001.SS",
        "index",
        {
            "chart": {
                "result": [{
                    "meta": {
                        "regularMarketPrice": 3814.282,
                        "chartPreviousClose": 4094.397,
                        "regularMarketTime": 1785378390,
                    },
                    "indicators": {
                        "quote": [{
                            "close": [3813.315, 3828.469, 3814.282],
                        }],
                    },
                }],
            },
        },
    )
    assert shanghai["previousClose"] == 3828.469
    assert shanghai["change"] == 3814.282 - 3828.469
    assert shanghai["marketState"] == "DELAYED"

    headlines = desktop_api.parse_yahoo_headlines("""
        <rss><channel>
          <item><title>Markets &amp; rates</title><link>https://example.com/one</link><pubDate>Today</pubDate></item>
          <item><title>Second story</title><link>https://example.com/two</link></item>
        </channel></rss>
    """)
    assert headlines[0]["title"] == "Markets & rates"
    assert len(headlines) == 2


def test_parses_multiple_headline_pages() -> None:
    items = "".join(
        f"<item><title>Headline {index}</title><link>https://example.com/{index}</link>"
        f"<pubDate>Sun, 26 Jul 2026 12:{index:02d}:00 GMT</pubDate></item>"
        for index in range(12)
    )

    headlines = desktop_api.parse_yahoo_headlines(f"<rss><channel>{items}</channel></rss>")

    assert len(headlines) == 12
    assert headlines[5]["title"] == "Headline 5"
    assert headlines[10]["title"] == "Headline 10"


def test_parses_yahoo_search_headlines() -> None:
    headlines = desktop_api.parse_yahoo_search_headlines({
        "news": [
            {
                "title": "Stocks &amp; rates",
                "link": "https://finance.yahoo.com/news/example",
                "providerPublishTime": 1785071460,
            },
            {"title": "Missing URL"},
        ],
    })

    assert headlines == [{
        "title": "Stocks & rates",
        "url": "https://finance.yahoo.com/news/example",
        "publishedAt": "2026-07-26T13:11:00+00:00",
    }]


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
        assert len(payload["portfolioKey"]) == 16

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


def test_risk_history_returns_comparable_normalized_and_component_trends() -> None:
    base_position = {
        "id": "trend-position",
        "symbol": "TREND",
        "type": "Stock",
        "quantity": 10,
        "marketValue": 1000,
        "beta": 1,
        "delta": 1,
    }
    with TestClient(app) as client:
        for volatility in (0.2, 0.3):
            response = client.post("/api/v1/risk/calculate", json={
                "positions": [{**base_position, "volatility": volatility}],
                "model": "parametric",
                "confidence": 0.975,
                "horizon": 1,
            })
            assert response.status_code == 200
        history = client.get(
            "/api/v1/risk/history",
            params={
                "model": "parametric",
                "confidence": 0.975,
                "horizon": 1,
                "frequency": "all",
            },
        )
    assert history.status_code == 200
    points = history.json()["points"]
    assert history.json()["excludedInvalidPoints"] == 0
    assert len(points) == 2
    assert points[1]["var"] > points[0]["var"]
    assert points[1]["varPercent"] == points[1]["var"] / points[1]["marketValue"]
    assert points[1]["contributions"][0]["symbol"] == "TREND"
    assert points[1]["contributions"][0]["change"] > 0


def test_risk_history_filters_portfolio_and_uses_latest_daily_run() -> None:
    with TestClient(app) as client:
        first = client.post("/api/v1/risk/calculate", json={
            "positions": [{
                "id": "first", "symbol": "AAA", "type": "Stock",
                "quantity": 10, "marketValue": 1000, "volatility": 0.2,
                "beta": 1, "delta": 1,
            }],
            "model": "parametric", "confidence": 0.96, "horizon": 1,
        }).json()
        client.post("/api/v1/risk/calculate", json={
            "positions": [{
                "id": "second", "symbol": "BBB", "type": "Stock",
                "quantity": 20, "marketValue": 2000, "volatility": 0.3,
                "beta": 1, "delta": 1,
            }],
            "model": "parametric", "confidence": 0.96, "horizon": 1,
        })
        history = client.get("/api/v1/risk/history", params={
            "model": "parametric",
            "confidence": 0.96,
            "horizon": 1,
            "portfolio": first["portfolioKey"],
        })
    payload = history.json()
    assert payload["frequency"] == "daily"
    assert payload["portfolioKey"] == first["portfolioKey"]
    assert len(payload["points"]) == 1
    assert payload["points"][0]["contributions"][0]["symbol"] == "AAA"


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
