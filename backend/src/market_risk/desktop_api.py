import re
from datetime import datetime, timezone
from typing import Annotated, Any
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .database import get_session
from .market_data import load_series
from .models import PortfolioVersion, RateCalibration

router = APIRouter(prefix="/api/v1")
SessionDependency = Annotated[Session, Depends(get_session)]
SettingsDependency = Annotated[Settings, Depends(get_settings)]


class PortfolioPayload(BaseModel):
    positions: list[dict[str, Any]] = Field(min_length=1)
    previousPositions: list[dict[str, Any]] | None = None
    sourceName: str | None = None


def serialize_portfolio(version: PortfolioVersion) -> dict[str, Any]:
    return {
        "id": version.id,
        "createdAt": version.created_at.isoformat(),
        "archivedAt": version.archived_at.isoformat() if version.archived_at else None,
        "sourceName": version.source_name,
        "isDefault": version.is_default,
        "positions": version.positions_json,
    }


def portfolio_versions(session: Session) -> list[dict[str, Any]]:
    versions = session.scalars(
        select(PortfolioVersion).order_by(
            PortfolioVersion.is_default.desc(),
            PortfolioVersion.archived_at.desc(),
            PortfolioVersion.created_at.desc(),
        ).limit(50),
    )
    return [serialize_portfolio(version) for version in versions]


@router.get("/portfolios")
def get_portfolios(session: SessionDependency) -> dict[str, Any]:
    return {"versions": portfolio_versions(session)}


@router.post("/portfolios")
def save_portfolio(payload: PortfolioPayload, session: SessionDependency) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    current = session.scalar(select(PortfolioVersion).where(PortfolioVersion.is_default.is_(True)))
    if current:
        current.is_default = False
        current.archived_at = now
    elif payload.previousPositions:
        session.add(PortfolioVersion(
            id=str(uuid4()),
            created_at=now,
            archived_at=now,
            source_name="Built-in default",
            positions_json=payload.previousPositions,
            is_default=False,
        ))
    session.add(PortfolioVersion(
        id=str(uuid4()),
        created_at=now,
        source_name=(payload.sourceName or "Saved portfolio").strip(),
        positions_json=payload.positions,
        is_default=True,
    ))
    session.commit()
    return {"versions": portfolio_versions(session)}


@router.put("/portfolios")
def update_portfolio(payload: PortfolioPayload, session: SessionDependency) -> dict[str, Any]:
    current = session.scalar(select(PortfolioVersion).where(PortfolioVersion.is_default.is_(True)))
    if not current:
        raise HTTPException(status_code=404, detail="No current default portfolio was found.")
    current.positions_json = payload.positions
    session.commit()
    return {"versions": portfolio_versions(session)}


@router.get("/market/history")
async def market_history(
    session: SessionDependency,
    settings: SettingsDependency,
    symbols: str = Query(min_length=1),
) -> dict[str, Any]:
    requested = list(dict.fromkeys(
        symbol.strip().upper() for symbol in symbols.split(",") if symbol.strip()
    ))[:30]
    series: list[dict[str, Any]] = []
    for symbol in requested:
        try:
            records = await load_series(session, symbol, settings)
        except Exception:
            continue
        if not records:
            continue
        series.append({
            "symbol": symbol,
            "sourceSymbol": records[-1].source_symbol,
            "dates": [record.trading_date.isoformat() for record in records],
            "adjustedClose": [record.adjusted_close for record in records],
            "latestPrice": records[-1].adjusted_close,
            "latestPriceAt": records[-1].trading_date.isoformat(),
            "currency": "USD",
        })
    if not series:
        raise HTTPException(status_code=502, detail="No price history was returned.")
    return {
        "source": "Yahoo Finance adjusted daily close (local Python cache)",
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "mappings": {item["symbol"]: item["sourceSymbol"] for item in series},
        "series": series,
    }


async def treasury_calibration() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    month = now.strftime("%Y%m")
    url = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml"
    params = {
        "data": "daily_treasury_yield_curve",
        "field_tdr_date_value_month": month,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
    entries = re.findall(r"<entry>[\s\S]*?</entry>", response.text, flags=re.IGNORECASE)
    if not entries:
        raise ValueError("Treasury yield curve returned no observations.")
    latest = entries[-1]
    definitions = [
        (1 / 12, "BC_1MONTH"), (0.25, "BC_3MONTH"), (0.5, "BC_6MONTH"),
        (1, "BC_1YEAR"), (2, "BC_2YEAR"), (3, "BC_3YEAR"), (5, "BC_5YEAR"),
        (7, "BC_7YEAR"), (10, "BC_10YEAR"), (20, "BC_20YEAR"), (30, "BC_30YEAR"),
    ]
    curve = []
    for maturity, field in definitions:
        match = re.search(fr"<d:{field}[^>]*>([^<]+)</d:{field}>", latest, re.IGNORECASE)
        if not match:
            continue
        annual_yield = float(match.group(1)) / 100
        curve.append({
            "maturity": maturity,
            "yield": annual_yield,
            "discountFactor": 1 / (1 + annual_yield / 2) ** (maturity * 2),
        })
    if len(curve) < 4:
        raise ValueError("The Treasury curve has too few valid maturity points.")
    date_match = re.search(r"<d:NEW_DATE[^>]*>([^<]+)</d:NEW_DATE>", latest, re.IGNORECASE)
    return {
        "id": str(uuid4()),
        "model": "Hull-White 1F",
        "version": "1.0",
        "curveDate": date_match.group(1) if date_match else now.isoformat(),
        "calibratedAt": now.isoformat(),
        "meanReversion": 0.03,
        "volatility": 0.01,
        "parameterSource": "governed-default",
        "curveSource": "U.S. Treasury daily par yield curve",
        "curve": curve,
        "fitRmse": 0,
        "status": "valid",
    }


async def refresh_rate_calibration(session: Session) -> dict[str, Any]:
    calibration = await treasury_calibration()
    session.execute(update(RateCalibration).where(
        RateCalibration.is_active.is_(True),
    ).values(is_active=False))
    session.add(RateCalibration(
        id=calibration["id"],
        calibrated_at=datetime.fromisoformat(calibration["calibratedAt"]),
        payload=calibration,
        is_active=True,
    ))
    session.commit()
    return calibration


@router.get("/rates")
async def get_rates(session: SessionDependency) -> dict[str, Any]:
    stored = session.scalar(select(RateCalibration).where(
        RateCalibration.is_active.is_(True),
    ).order_by(RateCalibration.calibrated_at.desc()))
    calibration = stored.payload if stored else await refresh_rate_calibration(session)
    calibrated = datetime.fromisoformat(calibration["calibratedAt"])
    if calibrated.tzinfo is None:
        calibrated = calibrated.replace(tzinfo=timezone.utc)
    stale = (datetime.now(timezone.utc) - calibrated).total_seconds() > 86_400
    return {"calibration": calibration, "stale": stale}


@router.post("/rates")
async def refresh_rates(session: SessionDependency) -> dict[str, Any]:
    try:
        return {"calibration": await refresh_rate_calibration(session), "stale": False}
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
