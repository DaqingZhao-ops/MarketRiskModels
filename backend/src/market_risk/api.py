from contextlib import asynccontextmanager
import hashlib
import json
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import __version__
from .backcast import calculate_fixed_portfolio_backcast
from .config import Settings, get_settings
from .database import Base, engine, get_session
from .desktop_api import router as desktop_router
from .engine import calculate_risk
from .market_data import load_series
from .models import RiskRun
from .schemas import BackcastRequest, ModelKind, RiskRequest, RiskResult


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Alembic owns production schema changes. A fresh local SQLite database is
    # created automatically for development convenience.
    if settings.database_url.startswith("sqlite"):
        Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Market Risk Service",
    version=__version__,
    lifespan=lifespan,
)
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type"],
)

SessionDependency = Annotated[Session, Depends(get_session)]
SettingsDependency = Annotated[Settings, Depends(get_settings)]
app.include_router(desktop_router)


def portfolio_key(positions: list[dict]) -> str:
    identity = sorted(
        [
            {
                "id": item.get("id"),
                "account": item.get("account"),
                "symbol": item.get("symbol"),
                "type": item.get("type"),
                "quantity": item.get("quantity", 0),
                "multiplier": item.get("multiplier", 1),
            }
            for item in positions
        ],
        key=lambda item: (
            str(item["account"] or ""),
            str(item["symbol"] or ""),
            str(item["id"] or ""),
        ),
    )
    encoded = json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()[:16]


def run_portfolio_key(run: RiskRun) -> str:
    stored = run.result_payload.get("portfolioKey")
    if stored:
        return str(stored)
    return portfolio_key(run.request_payload.get("positions", []))


def serialize_risk_trend(runs: list[RiskRun]) -> dict:
    points = []
    excluded_invalid_points = 0
    previous_contributions: dict[str, float] = {}
    for run in sorted(runs, key=lambda item: item.created_at):
        result = run.result_payload
        market_value = float(result.get("marketValue") or 0)
        value_at_risk = float(result.get("var") or 0)
        if market_value > 0 and value_at_risk <= 0:
            excluded_invalid_points += 1
            continue
        contributions: dict[str, dict[str, float | str]] = {}
        for item in result.get("contributions", []):
            symbol = str(item.get("symbol") or "Unknown")
            entry = contributions.setdefault(
                symbol,
                {"symbol": symbol, "amount": 0.0, "share": 0.0},
            )
            entry["amount"] = float(entry["amount"]) + float(item.get("amount") or 0)
            entry["share"] = float(entry["share"]) + float(item.get("share") or 0)
        serialized_contributions = []
        for symbol, item in contributions.items():
            previous = previous_contributions.get(symbol)
            amount = float(item["amount"])
            serialized_contributions.append({
                **item,
                "change": amount - previous if previous is not None else None,
                "changePercent": (
                    (amount - previous) / abs(previous)
                    if previous not in (None, 0)
                    else None
                ),
            })
            previous_contributions[symbol] = amount
        points.append({
            "runId": run.id,
            "timestamp": run.created_at.isoformat(),
            "marketValue": market_value,
            "var": value_at_risk,
            "varPercent": value_at_risk / market_value if market_value else 0,
            "expectedShortfall": float(result.get("expectedShortfall") or 0),
            "dailyVolatility": float(result.get("dailyVolatility") or 0),
            "contributions": sorted(
                serialized_contributions,
                key=lambda item: abs(float(item["amount"])),
                reverse=True,
            ),
        })
    return {
        "points": points,
        "excludedInvalidPoints": excluded_invalid_points,
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "engine": "Python", "version": __version__}


@app.post("/api/v1/risk/calculate", response_model=RiskResult)
async def risk_calculation(
    request: RiskRequest,
    session: SessionDependency,
    service_settings: SettingsDependency,
) -> RiskResult:
    if request.horizon not in {1, 10}:
        raise HTTPException(status_code=422, detail="Horizon must be 1 or 10 trading days.")

    price_maps: dict[str, dict[str, float]] = {}
    if request.model == ModelKind.HISTORICAL:
        try:
            for symbol in sorted({position.symbol for position in request.positions}):
                records = await load_series(
                    session,
                    symbol,
                    service_settings,
                    force_refresh=request.refresh_market_data,
                )
                price_maps[symbol] = {
                    record.trading_date.isoformat(): record.adjusted_close
                    for record in records
                }
        except Exception as error:
            raise HTTPException(status_code=502, detail=str(error)) from error

    result = calculate_risk(request, price_maps)
    key = portfolio_key(request.model_dump(mode="json", by_alias=True)["positions"])
    audited_result = result.model_copy(update={"portfolio_key": key})
    run = RiskRun(
        model=request.model.value,
        confidence=request.confidence,
        horizon_days=request.horizon,
        request_payload=request.model_dump(mode="json", by_alias=True),
        result_payload=audited_result.model_dump(mode="json", by_alias=True),
        engine_version=__version__,
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return audited_result.model_copy(update={"run_id": run.id})


@app.get("/api/v1/risk/history")
def risk_history(
    session: SessionDependency,
    model: ModelKind = Query(default=ModelKind.PARAMETRIC),
    confidence: float = Query(default=0.99, gt=0.5, lt=1),
    horizon: int = Query(default=1),
    limit: int = Query(default=180, ge=2, le=1000),
    portfolio: str | None = Query(default=None),
    frequency: str = Query(default="daily", pattern="^(daily|all)$"),
) -> dict:
    if horizon not in {1, 10}:
        raise HTTPException(status_code=422, detail="Horizon must be 1 or 10 trading days.")
    candidate_runs = list(session.scalars(
        select(RiskRun)
        .where(
            RiskRun.model == model.value,
            RiskRun.confidence == confidence,
            RiskRun.horizon_days == horizon,
        )
        .order_by(RiskRun.created_at.desc())
        .limit(5000),
    ))
    if portfolio:
        candidate_runs = [
            run for run in candidate_runs
            if run_portfolio_key(run) == portfolio
        ]
    if frequency == "daily":
        latest_by_day = {}
        for run in candidate_runs:
            latest_by_day.setdefault(run.created_at.date(), run)
        runs = list(latest_by_day.values())[:limit]
    else:
        runs = candidate_runs[:limit]
    payload = serialize_risk_trend(runs)
    return {
        "model": model.value,
        "confidence": confidence,
        "horizon": horizon,
        "portfolioKey": portfolio,
        "frequency": frequency,
        **payload,
    }


@app.post("/api/v1/risk/backcast")
async def risk_backcast(
    request: BackcastRequest,
    session: SessionDependency,
    service_settings: SettingsDependency,
) -> dict:
    if request.horizon not in {1, 10}:
        raise HTTPException(status_code=422, detail="Horizon must be 1 or 10 trading days.")
    price_maps = {}
    try:
        for symbol in sorted({position.symbol for position in request.positions} | {"SPY"}):
            records = await load_series(
                session,
                symbol,
                service_settings,
                force_refresh=request.refresh_market_data,
            )
            price_maps[symbol] = {
                record.trading_date.isoformat(): record.adjusted_close
                for record in records
            }
        return calculate_fixed_portfolio_backcast(
            request,
            price_maps,
            days=request.days,
            lookback=request.lookback,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
