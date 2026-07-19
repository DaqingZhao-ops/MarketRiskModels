from collections.abc import Mapping, Sequence
from statistics import NormalDist

import numpy as np

from .schemas import Contribution, ModelKind, Position, RiskRequest, RiskResult

TRADING_DAYS = 252
MONTE_CARLO_SCENARIOS = 10_000
ENGINE_VERSION = "0.2.0"


def _correlation(left: Position, right: Position) -> float:
    if left.id == right.id:
        return 1.0
    systematic = left.beta * right.beta * 0.38
    same_class = 0.18 if left.type.replace(" Option", "") == right.type.replace(" Option", "") else 0
    return max(-0.65, min(0.82, systematic + same_class))


def _correlation_matrix(positions: Sequence[Position]) -> np.ndarray:
    matrix = np.array(
        [[_correlation(left, right) for right in positions] for left in positions],
        dtype=float,
    )
    matrix = (matrix + matrix.T) / 2
    eigenvalues, eigenvectors = np.linalg.eigh(matrix)
    repaired = eigenvectors @ np.diag(np.maximum(eigenvalues, 1e-8)) @ eigenvectors.T
    scale = np.sqrt(np.diag(repaired))
    repaired = repaired / np.outer(scale, scale)
    np.fill_diagonal(repaired, 1.0)
    return repaired


def _daily_volatility(positions: Sequence[Position]) -> float:
    exposures = np.array(
        [
            position.market_value * position.delta * position.volatility / np.sqrt(TRADING_DAYS)
            for position in positions
        ],
    )
    variance = exposures @ _correlation_matrix(positions) @ exposures
    return float(np.sqrt(max(variance, 0)))


def _monte_carlo_losses(positions: Sequence[Position], horizon: int) -> np.ndarray:
    rng = np.random.default_rng(20_260_718 + len(positions) * 101)
    cholesky = np.linalg.cholesky(_correlation_matrix(positions))
    independent = rng.standard_normal((MONTE_CARLO_SCENARIOS, len(positions)))
    correlated = independent @ cholesky.T
    exposures = np.array(
        [
            position.market_value
            * position.delta
            * position.volatility
            / np.sqrt(TRADING_DAYS)
            * np.sqrt(horizon)
            for position in positions
        ],
    )
    return -(correlated @ exposures)


def _historical_losses(
    positions: Sequence[Position],
    prices: Mapping[str, Mapping[str, float]],
    horizon: int,
) -> tuple[np.ndarray, list[str]]:
    if not prices or any(position.symbol not in prices for position in positions):
        return np.array([], dtype=float), []
    common_dates = sorted(set.intersection(*(set(prices[position.symbol]) for position in positions)))
    losses: list[float] = []
    ending_dates: list[str] = []
    for index in range(horizon, len(common_dates)):
        start = common_dates[index - horizon]
        end = common_dates[index]
        pnl = sum(
            position.market_value
            * position.delta
            * (prices[position.symbol][end] / prices[position.symbol][start] - 1)
            for position in positions
        )
        losses.append(-pnl)
        ending_dates.append(end)
    return np.asarray(losses, dtype=float), ending_dates


def _quantile(losses: np.ndarray, confidence: float) -> float:
    if losses.size == 0:
        return 0.0
    return float(np.quantile(losses, confidence, method="inverted_cdf"))


def _histogram(losses: np.ndarray, value_range: float) -> list[float]:
    if losses.size == 0:
        return [0.0] * 31
    counts, _ = np.histogram(losses, bins=31, range=(-value_range, value_range))
    maximum = max(int(counts.max()), 1)
    return [float(value / maximum) for value in counts]


def calculate_risk(
    request: RiskRequest,
    prices: Mapping[str, Mapping[str, float]] | None = None,
) -> RiskResult:
    positions = request.positions
    market_value = sum(abs(position.market_value) for position in positions) or 1.0
    daily_volatility = _daily_volatility(positions)
    history_dates: list[str] = []

    if request.model == ModelKind.HISTORICAL:
        losses, history_dates = _historical_losses(
            positions,
            prices or {},
            request.horizon,
        )
        one_day_losses, _ = _historical_losses(positions, prices or {}, 1)
        daily_volatility = float(np.std(one_day_losses, ddof=1)) if one_day_losses.size > 1 else 0.0
    elif request.model == ModelKind.MONTE_CARLO:
        losses = _monte_carlo_losses(positions, request.horizon)
    else:
        display_losses = _monte_carlo_losses(positions, request.horizon)[:2_500]
        losses = display_losses

    if request.model == ModelKind.PARAMETRIC:
        z_score = NormalDist().inv_cdf(request.confidence)
        scaled_volatility = daily_volatility * np.sqrt(request.horizon)
        value_at_risk = z_score * scaled_volatility
        expected_shortfall = (
            scaled_volatility
            * NormalDist().pdf(z_score)
            / (1 - request.confidence)
        )
        observations = len(positions) ** 2
    else:
        value_at_risk = max(0.0, _quantile(losses, request.confidence))
        tail = losses[losses >= value_at_risk]
        expected_shortfall = float(tail.mean()) if tail.size else 0.0
        observations = int(losses.size)

    z_score = NormalDist().inv_cdf(request.confidence)
    standalone = sum(
        abs(position.market_value * position.delta)
        * position.volatility
        / np.sqrt(TRADING_DAYS)
        * z_score
        * np.sqrt(request.horizon)
        for position in positions
    )
    raw_amounts = [
        abs(
            position.market_value
            * position.delta
            * position.volatility
            * (0.35 + abs(position.beta)),
        )
        for position in positions
    ]
    contribution_total = sum(raw_amounts) or 1.0
    contributions = sorted(
        [
            Contribution(
                **position.model_dump(),
                amount=amount,
                share=amount / contribution_total,
            )
            for position, amount in zip(positions, raw_amounts, strict=True)
        ],
        key=lambda item: item.share,
        reverse=True,
    )
    maximum_loss = max(
        [abs(float(loss)) for loss in losses] + [value_at_risk * 1.3, 1.0],
    )
    value_range = float(np.ceil(maximum_loss / 5_000) * 5_000)
    var_marker = max(3.0, min(97.0, 50 + value_at_risk / (2 * value_range) * 100))

    return RiskResult(
        market_value=market_value,
        var=value_at_risk,
        expected_shortfall=expected_shortfall,
        daily_volatility=daily_volatility,
        diversification_benefit=max(0.0, standalone - value_at_risk),
        observations=observations,
        histogram=_histogram(losses, value_range),
        range=value_range,
        var_marker=var_marker,
        contributions=contributions,
        history_start=history_dates[0] if history_dates else None,
        history_end=history_dates[-1] if history_dates else None,
    )

