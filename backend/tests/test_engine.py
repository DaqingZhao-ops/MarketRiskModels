import pytest

from market_risk.engine import _directional_exposure, calculate_risk
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


def test_historical_nonpositive_quantile_uses_volatility_floor() -> None:
    position = Position(
        id="risky",
        symbol="RISK",
        type="Stock",
        quantity=10,
        market_value=1_000,
        volatility=0.3,
        beta=1,
        delta=1,
    )
    prices = {
        "RISK": {
            "2026-01-01": 100,
            "2026-01-02": 101,
            "2026-01-03": 102,
            "2026-01-04": 103,
        },
    }
    result = calculate_risk(RiskRequest(
        positions=[position],
        model="historical",
        confidence=0.99,
        horizon=1,
    ), prices)
    assert result.var > 0
    assert result.expected_shortfall > result.var
    assert result.var_floor_applied is True
    assert result.var == result.var_floor


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


def test_directional_exposure_uses_quantity_for_position_direction() -> None:
    common = {
        "symbol": "AAA",
        "type": "Stock",
        "market_value": 1_000,
        "volatility": 0.2,
        "beta": 1,
    }
    long_stock = Position(id="long-stock", quantity=10, delta=1, **common)
    short_stock = Position(id="short-stock", quantity=-10, delta=1, **common)
    long_put = Position(id="long-put", quantity=10, delta=-0.4, **common)
    short_put = Position(id="short-put", quantity=-10, delta=-0.4, **common)

    assert _directional_exposure(long_stock) == 1_000
    assert _directional_exposure(short_stock) == -1_000
    assert _directional_exposure(long_put) == -400
    assert _directional_exposure(short_put) == 400


def test_component_var_is_additive_and_recognizes_hedges() -> None:
    positions = [
        Position(
            id="long", symbol="AAA", type="Stock", quantity=10,
            market_value=1_000, volatility=0.2, beta=1, delta=1,
        ),
        Position(
            id="hedge", symbol="BBB", type="Stock", quantity=-5,
            market_value=500, volatility=0.2, beta=1, delta=1,
        ),
    ]
    result = calculate_risk(RiskRequest(
        positions=positions,
        model="parametric",
        confidence=0.99,
        horizon=1,
    ))
    assert sum(item.amount for item in result.contributions) == pytest.approx(result.var)
    assert sum(item.share for item in result.contributions) == pytest.approx(1)
    assert next(item for item in result.contributions if item.id == "hedge").amount < 0
