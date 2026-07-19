from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from . import __version__
from .config import Settings, get_settings
from .database import Base, engine, get_session
from .desktop_api import router as desktop_router
from .engine import calculate_risk
from .market_data import load_series
from .models import RiskRun
from .schemas import ModelKind, RiskRequest, RiskResult


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
    run = RiskRun(
        model=request.model.value,
        confidence=request.confidence,
        horizon_days=request.horizon,
        request_payload=request.model_dump(mode="json", by_alias=True),
        result_payload=result.model_dump(mode="json", by_alias=True),
        engine_version=__version__,
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return result.model_copy(update={"run_id": run.id})
