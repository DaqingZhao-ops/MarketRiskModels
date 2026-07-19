import { NextResponse } from "next/server";

import {
  createRateCalibrationsIndex,
  createRateCalibrationsTable,
} from "../../../db/schema";
import {
  fitHullWhiteCurve,
  isHullWhiteStale,
  type HullWhiteCalibration,
} from "../../../lib/hull-white";

type D1Result<T> = { results?: T[] };
type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  run: () => Promise<unknown>;
  all: <T>() => Promise<D1Result<T>>;
};
type D1Database = {
  prepare: (sql: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown>;
};
type CalibrationRow = {
  id: string;
  model: "Hull-White 1F";
  version: string;
  curve_date: string;
  calibrated_at: string;
  mean_reversion: number;
  volatility: number;
  parameter_source: "governed-default";
  curve_source: string;
  curve_json: string;
  fit_rmse: number;
  status: "valid";
};

async function database() {
  const { env } = await import("cloudflare:workers");
  return (env as unknown as { DB: D1Database }).DB;
}

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare(createRateCalibrationsTable),
    db.prepare(createRateCalibrationsIndex),
  ]);
}

function serialize(row: CalibrationRow): HullWhiteCalibration {
  return {
    id: row.id,
    model: row.model,
    version: row.version,
    curveDate: row.curve_date,
    calibratedAt: row.calibrated_at,
    meanReversion: row.mean_reversion,
    volatility: row.volatility,
    parameterSource: row.parameter_source,
    curveSource: row.curve_source,
    curve: JSON.parse(row.curve_json),
    fitRmse: row.fit_rmse,
    status: row.status,
  };
}

async function activeCalibration(db: D1Database) {
  const response = await db.prepare(`
    SELECT id, model, version, curve_date, calibrated_at, mean_reversion,
      volatility, parameter_source, curve_source, curve_json, fit_rmse, status
    FROM interest_rate_calibrations
    WHERE is_active = 1
    ORDER BY calibrated_at DESC
    LIMIT 1
  `).all<CalibrationRow>();
  return response.results?.[0] ? serialize(response.results[0]) : undefined;
}

async function fetchTreasuryCurve() {
  const now = new Date();
  const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const url = new URL("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml");
  url.searchParams.set("data", "daily_treasury_yield_curve");
  url.searchParams.set("field_tdr_date_value_month", month);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Treasury yield curve request failed (${response.status})`);
  const xml = await response.text();
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/gi) ?? [];
  const latest = entries.at(-1);
  if (!latest) throw new Error("Treasury yield curve returned no observations.");
  const value = (field: string) => {
    const match = latest.match(new RegExp(`<d:${field}[^>]*>([^<]+)<\\/d:${field}>`, "i"));
    return match ? Number(match[1]) / 100 : Number.NaN;
  };
  const dateMatch = latest.match(/<d:NEW_DATE[^>]*>([^<]+)<\/d:NEW_DATE>/i);
  const definitions = [
    [1 / 12, "BC_1MONTH"], [0.25, "BC_3MONTH"], [0.5, "BC_6MONTH"],
    [1, "BC_1YEAR"], [2, "BC_2YEAR"], [3, "BC_3YEAR"], [5, "BC_5YEAR"],
    [7, "BC_7YEAR"], [10, "BC_10YEAR"], [20, "BC_20YEAR"], [30, "BC_30YEAR"],
  ] as const;
  const yields = definitions
    .map(([maturity, field]) => ({ maturity, yield: value(field) }))
    .filter((point) => Number.isFinite(point.yield));
  return fitHullWhiteCurve(
    yields,
    dateMatch?.[1] ?? now.toISOString(),
    now.toISOString(),
  );
}

async function saveCalibration(db: D1Database, calibration: HullWhiteCalibration) {
  await db.batch([
    db.prepare("UPDATE interest_rate_calibrations SET is_active = 0 WHERE is_active = 1"),
    db.prepare(`
      INSERT INTO interest_rate_calibrations (
        id, model, version, curve_date, calibrated_at, mean_reversion,
        volatility, parameter_source, curve_source, curve_json, fit_rmse,
        status, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).bind(
      calibration.id,
      calibration.model,
      calibration.version,
      calibration.curveDate,
      calibration.calibratedAt,
      calibration.meanReversion,
      calibration.volatility,
      calibration.parameterSource,
      calibration.curveSource,
      JSON.stringify(calibration.curve),
      calibration.fitRmse,
      calibration.status,
    ),
  ]);
}

async function refresh(db: D1Database) {
  const calibration = await fetchTreasuryCurve();
  await saveCalibration(db, calibration);
  return calibration;
}

export async function GET() {
  const db = await database();
  await ensureSchema(db);
  let calibration = await activeCalibration(db);
  if (!calibration) calibration = await refresh(db);
  return NextResponse.json({
    calibration,
    stale: isHullWhiteStale(calibration),
  });
}

export async function POST() {
  try {
    const db = await database();
    await ensureSchema(db);
    const calibration = await refresh(db);
    return NextResponse.json({ calibration, stale: false });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to refresh Hull–White calibration." },
      { status: 502 },
    );
  }
}
