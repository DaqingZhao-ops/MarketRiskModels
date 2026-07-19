from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(word.capitalize() for word in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
    )


class ModelKind(StrEnum):
    HISTORICAL = "historical"
    MONTE_CARLO = "monteCarlo"
    PARAMETRIC = "parametric"


class Position(ApiModel):
    id: str
    symbol: str = Field(min_length=1, max_length=64)
    type: str = Field(min_length=1, max_length=64)
    market_value: float
    volatility: float = Field(ge=0)
    beta: float
    delta: float


class RiskRequest(ApiModel):
    positions: list[Position] = Field(min_length=1, max_length=200)
    model: ModelKind
    confidence: float = Field(gt=0.5, lt=1)
    horizon: int = Field(default=1)
    refresh_market_data: bool = False


class Contribution(Position):
    amount: float
    share: float


class RiskResult(ApiModel):
    market_value: float
    var: float
    expected_shortfall: float
    daily_volatility: float
    diversification_benefit: float
    observations: int
    histogram: list[float]
    range: float
    var_marker: float
    contributions: list[Contribution]
    history_start: date | None = None
    history_end: date | None = None
    engine: str = "Python"
    run_id: int | None = None


class PriceObservation(ApiModel):
    trading_date: date
    adjusted_close: float


class MarketSeries(ApiModel):
    symbol: str
    source_symbol: str
    observations: list[PriceObservation]
    retrieved_at: datetime

