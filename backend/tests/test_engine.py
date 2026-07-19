from market_risk.engine import calculate_risk
from market_risk.schemas import Position, RiskRequest


POSITIONS = [
    Position(
        id="1",
        symbol="AAA",
        type="Stock",
        market_value=100_000,
        volatility=0.2,
        beta=1,
        delta=1,
    ),
    Position(
        id="2",
        symbol="BBB",
        type="Bond",
        market_value=80_000,
        volatility=0.08,
        beta=-0.1,
        delta=1,
    ),
]


def test_monte_carlo_is_deterministic() -> None:
    request = RiskRequest(
        positions=POSITIONS,
        model="monteCarlo",
        confidence=0.99,
        horizon=1,
    )
    first = calculate_risk(request)
    second = calculate_risk(request)
    assert first.var == second.var
    assert first.expected_shortfall > first.var > 0
    assert first.observations == 10_000
    assert abs(sum(item.share for item in first.contributions) - 1) < 1e-10


def test_historical_uses_overlapping_horizon_returns() -> None:
    prices = {
        "AAA": {f"2026-01-{day:02d}": 100 + day for day in range(1, 13)},
        "BBB": {f"2026-01-{day:02d}": 100 - day / 2 for day in range(1, 13)},
    }
    request = RiskRequest(
        positions=POSITIONS,
        model="historical",
        confidence=0.95,
        horizon=10,
    )
    result = calculate_risk(request, prices)
    assert result.observations == 2
    assert result.history_start.isoformat() == "2026-01-11"
    assert result.history_end.isoformat() == "2026-01-12"


def test_parametric_result_scales_with_horizon() -> None:
    one_day = calculate_risk(
        RiskRequest(
            positions=POSITIONS,
            model="parametric",
            confidence=0.99,
            horizon=1,
        ),
    )
    ten_day = calculate_risk(
        RiskRequest(
            positions=POSITIONS,
            model="parametric",
            confidence=0.99,
            horizon=10,
        ),
    )
    assert abs(ten_day.var / one_day.var - 10**0.5) < 1e-10


def test_same_symbol_across_accounts_uses_one_market_risk_factor() -> None:
    combined = Position(
        id="combined", symbol="AAPL", type="Stock",
        market_value=2_000, volatility=0.2, beta=1, delta=1,
    )
    split = [
        Position(
            id=f"account-{account}", symbol="AAPL", type="Stock",
            market_value=1_000, volatility=0.2, beta=1, delta=1,
        )
        for account in ("a", "b")
    ]
    combined_result = calculate_risk(RiskRequest(
        positions=[combined], model="parametric", confidence=0.99, horizon=1,
    ))
    split_result = calculate_risk(RiskRequest(
        positions=split, model="parametric", confidence=0.99, horizon=1,
    ))
    assert abs(split_result.daily_volatility - combined_result.daily_volatility) < 1e-6
