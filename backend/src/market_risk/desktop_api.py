import asyncio
import math
import re
from datetime import datetime, timezone
from typing import Annotated, Any
from uuid import uuid4

import httpx
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
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


RATE_MODELS = {"Hull-White 1F", "G2++ 2F"}
HW_BOUNDS = {
    "meanReversion": [0.001, 5.00],
    "volatility": [0.001, 0.10],
}
G2_BOUNDS = {
    "meanReversion": [0.001, 5.00],
    "volatility": [0.001, 0.10],
    "secondFactorMeanReversion": [0.001, 5.00],
    "secondFactorVolatility": [0.001, 0.10],
    "factorCorrelation": [-0.95, 0.95],
}


def _bounded(value: float, bounds: list[float]) -> float:
    return max(bounds[0], min(bounds[1], value))


def _fit_mean_reverting_factor(
    values: np.ndarray,
    bounds: list[float],
) -> tuple[float, np.ndarray, list[float]]:
    centered = values - values.mean()
    lagged = centered[:-1]
    current = centered[1:]
    denominator = float(lagged @ lagged)
    phi = float(lagged @ current / denominator) if denominator > 1e-14 else 0.99
    phi = max(0.001, min(0.99996, phi))
    raw_mean_reversion = -math.log(phi) * 252
    mean_reversion = _bounded(raw_mean_reversion, bounds)
    innovations = current - math.exp(-mean_reversion / 252) * lagged
    phi_standard_error = math.sqrt(max(1 - phi ** 2, 1e-12) / len(lagged))
    phi_low = max(0.001, phi - 1.96 * phi_standard_error)
    phi_high = min(0.999999, phi + 1.96 * phi_standard_error)
    confidence_interval = [
        _bounded(-math.log(phi_high) * 252, bounds),
        _bounded(-math.log(phi_low) * 252, bounds),
    ]
    return mean_reversion, innovations, confidence_interval


def _principal_curve_factors(matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    centered = matrix - matrix.mean(axis=0)
    _, _, right_vectors = np.linalg.svd(centered, full_matrices=False)
    loadings = right_vectors[:2].T
    scores = centered @ loadings

    level_scale = float(loadings[:, 0].mean())
    if abs(level_scale) < 1e-8:
        level_scale = float(np.linalg.norm(loadings[:, 0]))
    slope_scale = float(loadings[-2:, 1].mean() - loadings[3:5, 1].mean())
    if abs(slope_scale) < 1e-8:
        slope_scale = float(np.linalg.norm(loadings[:, 1]))
    factors = np.column_stack([
        scores[:, 0] * level_scale,
        scores[:, 1] * slope_scale,
    ])
    return factors, loadings


def estimate_hull_white_parameters(
    observations: list[tuple[str, list[float]]],
) -> dict[str, Any]:
    if len(observations) < 60:
        raise ValueError("At least 60 daily Treasury curves are required for Hull-White calibration.")
    matrix = np.asarray([values for _, values in observations], dtype=float) / 100
    if matrix.ndim != 2 or matrix.shape[1] < 4 or not np.isfinite(matrix).all():
        raise ValueError("Treasury history contains invalid curve observations.")
    factors, loadings = _principal_curve_factors(matrix)
    mean_reversion, innovations, confidence_interval = _fit_mean_reverting_factor(
        factors[:, 0],
        HW_BOUNDS["meanReversion"],
    )
    volatility = _bounded(
        float(np.std(innovations, ddof=1) * np.sqrt(252)),
        HW_BOUNDS["volatility"],
    )
    centered = matrix - matrix.mean(axis=0)
    first_scores = centered @ loadings[:, 0]
    fitted_level = matrix.mean(axis=0) + np.outer(first_scores, loadings[:, 0])
    rmse_basis_points = float(np.sqrt(np.mean((matrix - fitted_level) ** 2)) * 10_000)
    return {
        "meanReversion": mean_reversion,
        "volatility": volatility,
        "meanReversionConfidenceInterval": confidence_interval,
        "fitRmse": rmse_basis_points,
        "observationCount": len(observations),
        "calibrationWindowStart": observations[0][0],
        "calibrationWindowEnd": observations[-1][0],
        "calibrationSource": "U.S. Treasury daily par-yield curve history",
        "calibrationObjective": "PCA level factor with exact-discrete OU estimation",
        "parameterBounds": HW_BOUNDS,
        "fallbackUsed": False,
    }


def estimate_g2_parameters(
    observations: list[tuple[str, list[float]]],
) -> dict[str, Any]:
    if len(observations) < 60:
        raise ValueError("At least 60 daily Treasury curves are required for G2++ calibration.")
    matrix = np.asarray([values for _, values in observations], dtype=float) / 100
    if matrix.ndim != 2 or matrix.shape[1] < 4 or not np.isfinite(matrix).all():
        raise ValueError("Treasury history contains invalid curve observations.")

    factors, _ = _principal_curve_factors(matrix)

    first_mean_reversion, first_innovations, first_confidence_interval = _fit_mean_reverting_factor(
        factors[:, 0],
        G2_BOUNDS["meanReversion"],
    )
    second_mean_reversion, second_innovations, second_confidence_interval = _fit_mean_reverting_factor(
        factors[:, 1],
        G2_BOUNDS["secondFactorMeanReversion"],
    )
    first_volatility = _bounded(
        float(np.std(first_innovations, ddof=1) * np.sqrt(252)),
        G2_BOUNDS["volatility"],
    )
    second_volatility = _bounded(
        float(np.std(second_innovations, ddof=1) * np.sqrt(252)),
        G2_BOUNDS["secondFactorVolatility"],
    )
    correlation = float(np.corrcoef(first_innovations, second_innovations)[0, 1])
    correlation = _bounded(
        correlation if np.isfinite(correlation) else -0.70,
        G2_BOUNDS["factorCorrelation"],
    )

    design = np.column_stack([np.ones(len(factors)), factors])
    fitted = design @ np.linalg.lstsq(design, matrix, rcond=None)[0]
    rmse_basis_points = float(np.sqrt(np.mean((matrix - fitted) ** 2)) * 10_000)
    return {
        "meanReversion": first_mean_reversion,
        "volatility": first_volatility,
        "secondFactorMeanReversion": second_mean_reversion,
        "secondFactorVolatility": second_volatility,
        "factorCorrelation": correlation,
        "meanReversionConfidenceInterval": first_confidence_interval,
        "secondFactorMeanReversionConfidenceInterval": second_confidence_interval,
        "fitRmse": rmse_basis_points,
        "observationCount": len(observations),
        "calibrationWindowStart": observations[0][0],
        "calibrationWindowEnd": observations[-1][0],
        "calibrationSource": "U.S. Treasury daily par-yield curve history",
        "calibrationObjective": "Two PCA curve factors with exact-discrete OU estimation",
        "parameterBounds": G2_BOUNDS,
        "fallbackUsed": False,
    }


async def fetch_treasury_history() -> list[tuple[str, list[float]]]:
    now = datetime.now(timezone.utc)
    fields = [
        "BC_3MONTH", "BC_6MONTH", "BC_1YEAR", "BC_2YEAR", "BC_3YEAR",
        "BC_5YEAR", "BC_7YEAR", "BC_10YEAR", "BC_20YEAR", "BC_30YEAR",
    ]
    observations: list[tuple[str, list[float]]] = []
    async with httpx.AsyncClient(timeout=30) as client:
        async def fetch_year(year: int) -> str:
            response = await client.get(
                "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml",
                params={
                    "data": "daily_treasury_yield_curve",
                    "field_tdr_date_value": str(year),
                },
            )
            response.raise_for_status()
            return response.text

        years = list(range(now.year - 9, now.year + 1))
        responses = await asyncio.gather(*(fetch_year(year) for year in years))
        for response_text in responses:
            for entry in re.findall(r"<entry>[\s\S]*?</entry>", response_text, flags=re.IGNORECASE):
                date_match = re.search(
                    r"<d:NEW_DATE[^>]*>([^<]+)</d:NEW_DATE>",
                    entry,
                    re.IGNORECASE,
                )
                values = []
                for field in fields:
                    match = re.search(fr"<d:{field}[^>]*>([^<]+)</d:{field}>", entry, re.IGNORECASE)
                    if not match:
                        values = []
                        break
                    values.append(float(match.group(1)))
                if date_match and values:
                    observations.append((date_match.group(1)[:10], values))
    return sorted(dict(observations).items())


async def treasury_calibration(model: str) -> dict[str, Any]:
    if model not in RATE_MODELS:
        raise ValueError(f"Unsupported interest-rate model: {model}")
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
    calibration = {
        "id": str(uuid4()),
        "model": model,
        "version": "1.1",
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
    try:
        history = await fetch_treasury_history()
        if model == "G2++ 2F":
            calibration.update(estimate_g2_parameters(history))
        else:
            calibration.update(estimate_hull_white_parameters(history))
        calibration["parameterSource"] = "historical-calibration"
    except Exception as error:
        if model == "G2++ 2F":
            calibration.update({
                "meanReversion": 0.10,
                "volatility": 0.01,
                "secondFactorMeanReversion": 0.30,
                "secondFactorVolatility": 0.015,
                "factorCorrelation": -0.70,
                "calibrationSource": "Governed G2++ fallback parameters",
                "calibrationObjective": "No calibration performed",
                "observationCount": 0,
                "parameterBounds": G2_BOUNDS,
                "fallbackUsed": True,
                "fallbackReason": str(error),
            })
        else:
            calibration.update({
                "calibrationSource": "Governed Hull-White fallback parameters",
                "calibrationObjective": "No calibration performed",
                "observationCount": 0,
                "parameterBounds": HW_BOUNDS,
                "fallbackUsed": True,
                "fallbackReason": str(error),
            })
    return calibration


async def refresh_rate_calibration(session: Session, model: str) -> dict[str, Any]:
    calibration = await treasury_calibration(model)
    session.add(RateCalibration(
        id=calibration["id"],
        calibrated_at=datetime.fromisoformat(calibration["calibratedAt"]),
        payload=calibration,
        is_active=True,
    ))
    session.commit()
    return calibration


@router.get("/rates")
async def get_rates(
    session: SessionDependency,
    model: str = Query(default="Hull-White 1F"),
) -> dict[str, Any]:
    if model not in RATE_MODELS:
        raise HTTPException(status_code=422, detail=f"Unsupported interest-rate model: {model}")
    stored = next((
        item for item in session.scalars(
            select(RateCalibration).order_by(RateCalibration.calibrated_at.desc()),
        )
        if item.payload.get("model") == model
    ), None)
    if stored and (
        stored.payload.get("parameterSource") == "governed-default"
        or stored.payload.get("version") != "1.1"
    ):
        stored = None
    calibration = stored.payload if stored else await refresh_rate_calibration(session, model)
    calibrated = datetime.fromisoformat(calibration["calibratedAt"])
    if calibrated.tzinfo is None:
        calibrated = calibrated.replace(tzinfo=timezone.utc)
    stale = (
        (datetime.now(timezone.utc) - calibrated).total_seconds() > 86_400
        or calibration.get("parameterSource") == "governed-default"
    )
    return {"calibration": calibration, "stale": stale}


@router.post("/rates")
async def refresh_rates(
    session: SessionDependency,
    model: str = Query(default="Hull-White 1F"),
) -> dict[str, Any]:
    try:
        return {
            "calibration": await refresh_rate_calibration(session, model),
            "stale": False,
        }
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
