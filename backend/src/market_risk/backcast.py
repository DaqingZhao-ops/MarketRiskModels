from collections.abc import Mapping
from datetime import date

import numpy as np

from .engine import TRADING_DAYS, _directional_exposure, calculate_risk
from .schemas import Position, RiskRequest


def _returns(prices: list[float]) -> np.ndarray:
    values = np.asarray(prices, dtype=float)
    return values[1:] / values[:-1] - 1


def _rolling_factors(
    symbol_prices: Mapping[str, float],
    benchmark_prices: Mapping[str, float],
    dates: list[str],
    fallback_beta: float,
) -> tuple[float, float]:
    asset_returns = _returns([symbol_prices[item] for item in dates])
    volatility = (
        float(np.std(asset_returns, ddof=1) * np.sqrt(TRADING_DAYS))
        if asset_returns.size > 1
        else 0.0
    )
    benchmark_returns = _returns([benchmark_prices[item] for item in dates])
    variance = float(np.var(benchmark_returns, ddof=1)) if benchmark_returns.size > 1 else 0
    beta = (
        float(np.cov(asset_returns, benchmark_returns, ddof=1)[0, 1] / variance)
        if variance > 0
        else fallback_beta
    )
    return volatility, beta


def _portfolio_beta(
    positions: list[Position],
    prices: Mapping[str, Mapping[str, float]],
    dates: list[str],
) -> float:
    gross_market_value = sum(abs(position.market_value) for position in positions)
    if gross_market_value <= 0:
        return 0.0
    portfolio_returns = np.zeros(len(dates) - 1)
    for position in positions:
        asset_returns = _returns([prices[position.symbol][item] for item in dates])
        weight = _directional_exposure(position) / gross_market_value
        portfolio_returns += weight * asset_returns
    benchmark_returns = _returns([prices["SPY"][item] for item in dates])
    variance = float(np.var(benchmark_returns, ddof=1))
    if variance <= 0:
        return 0.0
    return float(np.cov(portfolio_returns, benchmark_returns, ddof=1)[0, 1] / variance)


def calculate_fixed_portfolio_backcast(
    request: RiskRequest,
    prices: Mapping[str, Mapping[str, float]],
    days: int = 30,
    lookback: int = 252,
) -> dict:
    symbols = {position.symbol for position in request.positions}
    required = symbols | {"SPY"}
    if any(symbol not in prices for symbol in required):
        missing = sorted(symbol for symbol in required if symbol not in prices)
        raise ValueError(f"Missing price history for: {', '.join(missing)}")
    common_dates = sorted(set.intersection(*(set(prices[symbol]) for symbol in required)))
    minimum = lookback + request.horizon
    if len(common_dates) <= minimum:
        raise ValueError(
            f"Backcast requires more than {minimum} synchronized observations; "
            f"received {len(common_dates)}.",
        )
    as_of_dates = common_dates[minimum:][-days:]
    latest_date = common_dates[-1]
    points = []
    previous_contributions: dict[str, float] = {}
    for as_of in as_of_dates:
        as_of_index = common_dates.index(as_of)
        window_dates = common_dates[as_of_index - lookback:as_of_index + 1]
        risk_dates = common_dates[:as_of_index + 1]
        window_prices = {
            symbol: {item: prices[symbol][item] for item in risk_dates}
            for symbol in symbols
        }
        positions = []
        for position in request.positions:
            symbol_prices = prices[position.symbol]
            revaluation = symbol_prices[as_of] / symbol_prices[latest_date]
            directly_revalued = position.type in {"Stock", "ETF", "Mutual Fund"}
            market_value = (
                abs(position.quantity * symbol_prices[as_of] * position.multiplier)
                if directly_revalued
                else position.market_value * revaluation
            )
            volatility, beta = _rolling_factors(
                symbol_prices,
                prices["SPY"],
                window_dates,
                position.beta,
            )
            positions.append(position.model_copy(update={
                "market_value": market_value,
                "price": (
                    symbol_prices[as_of]
                    if directly_revalued
                    else position.price * revaluation
                ),
                "volatility": volatility or position.volatility,
                "beta": beta,
            }))
        result = calculate_risk(
            request.model_copy(update={"positions": positions}),
            window_prices,
        )
        portfolio_beta = _portfolio_beta(positions, prices, window_dates)
        contributions: dict[str, dict] = {}
        for item in result.contributions:
            contribution = contributions.setdefault(
                item.symbol,
                {"symbol": item.symbol, "amount": 0.0, "share": 0.0},
            )
            contribution["amount"] += item.amount
            contribution["share"] += item.share
        serialized = []
        for symbol, contribution in contributions.items():
            previous = previous_contributions.get(symbol)
            amount = float(contribution["amount"])
            serialized.append({
                **contribution,
                "change": amount - previous if previous is not None else None,
                "changePercent": (
                    (amount - previous) / abs(previous)
                    if previous not in (None, 0)
                    else None
                ),
            })
            previous_contributions[symbol] = amount
        points.append({
            "timestamp": f"{as_of}T00:00:00Z",
            "marketValue": result.market_value,
            "var": result.var,
            "varPercent": result.var / result.market_value if result.market_value else 0,
            "expectedShortfall": result.expected_shortfall,
            "dailyVolatility": result.daily_volatility,
            "portfolioBeta": portfolio_beta,
            "contributions": sorted(
                serialized,
                key=lambda item: abs(item["amount"]),
                reverse=True,
            ),
            "varFloorApplied": result.var_floor_applied,
        })
    return {
        "mode": "fixedPortfolioBackcast",
        "days": days,
        "lookback": lookback,
        "asOf": date.fromisoformat(as_of_dates[-1]),
        "points": points,
        "assumptions": [
            "Current quantities are held fixed throughout the backcast.",
            "Market values are scaled by each instrument's mapped price history.",
            "Volatility and beta use trailing synchronized observations only.",
            "Option delta is held at its current value.",
        ],
    }
