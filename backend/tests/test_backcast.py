from datetime import date, timedelta

from market_risk.backcast import calculate_fixed_portfolio_backcast
from market_risk.schemas import RiskRequest


def test_fixed_portfolio_backcast_uses_rolling_point_in_time_windows() -> None:
    start = date(2025, 1, 1)
    dates = [(start + timedelta(days=index)).isoformat() for index in range(330)]
    asset = [100.0]
    benchmark = [100.0]
    for index in range(1, len(dates)):
        market_return = 0.006 if index % 2 else -0.004
        benchmark.append(benchmark[-1] * (1 + market_return))
        asset.append(asset[-1] * (1 + 0.0002 + 1.2 * market_return))
    prices = {
        "AAA": dict(zip(dates, asset, strict=True)),
        "SPY": dict(zip(dates, benchmark, strict=True)),
    }
    request = RiskRequest(
        positions=[{
            "id": "aaa",
            "symbol": "AAA",
            "type": "Stock",
            "quantity": 10,
            "price": asset[-1],
            "multiplier": 1,
            "marketValue": 10 * asset[-1],
            "volatility": 0.2,
            "beta": 1.2,
            "delta": 1,
        }],
        model="historical",
        confidence=0.99,
        horizon=1,
    )
    result = calculate_fixed_portfolio_backcast(request, prices, days=30, lookback=252)

    assert len(result["points"]) == 30
    assert result["points"][0]["timestamp"].startswith(dates[-30])
    assert result["points"][-1]["timestamp"].startswith(dates[-1])
    assert all(point["var"] > 0 for point in result["points"])
    assert result["points"][-1]["marketValue"] == 10 * asset[-1]
    assert abs(result["points"][-1]["portfolioBeta"] - 1.2) < 1e-10
    assert result["assumptions"][-1] == "Option delta is held at its current value."
