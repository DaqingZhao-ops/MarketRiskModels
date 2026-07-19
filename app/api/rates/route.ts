import { NextRequest, NextResponse } from "next/server";

import {
  createRateCalibrationsIndex,
  createRateCalibrationsTable,
} from "../../../db/schema";
import {
  fitHullWhiteCurve,
  fitG2Curve,
  isHullWhiteStale,
  type InterestRateCalibration,
  type RateModelName,
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
  model: RateModelName;
  version: string;
  curve_date: string;
  calibrated_at: string;
  mean_reversion: number;
  volatility: number;
  parameter_source: "governed-default" | "historical-calibration";
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
  const stored = JSON.parse(row.curve_json) as
    | HullWhiteCalibration["curve"]
    | { curve: HullWhiteCalibration["curve"]; diagnostics?: Partial<InterestRateCalibration> };
  const curve = Array.isArray(stored) ? stored : stored.curve;
  const diagnostics = Array.isArray(stored) ? {} : stored.diagnostics ?? {};
  return {
    id: row.id,
    model: row.model,
    version: row.version,
    curveDate: row.curve_date,
    calibratedAt: row.calibrated_at,
    meanReversion: row.mean_reversion,
    volatility: row.volatility,
    ...diagnostics,
    parameterSource: row.parameter_source,
    curveSource: row.curve_source,
    curve,
    fitRmse: row.fit_rmse,
    status: row.status,
  };
}

async function activeCalibration(db: D1Database, model: RateModelName) {
  const response = await db.prepare(`
    SELECT id, model, version, curve_date, calibrated_at, mean_reversion,
      volatility, parameter_source, curve_source, curve_json, fit_rmse, status
    FROM interest_rate_calibrations
    WHERE is_active = 1 AND model = ?
    ORDER BY calibrated_at DESC
    LIMIT 1
  `).bind(model).all<CalibrationRow>();
  return response.results?.[0] ? serialize(response.results[0]) : undefined;
}

async function fetchTreasuryCurve(model: RateModelName) {
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
  const calibration = model === "G2++ 2F" ? fitG2Curve(
    yields,
    dateMatch?.[1] ?? now.toISOString(),
    now.toISOString(),
  ) : fitHullWhiteCurve(
    yields,
    dateMatch?.[1] ?? now.toISOString(),
    now.toISOString(),
  );
  try {
    const history = await fetchTreasuryHistory();
    Object.assign(
      calibration,
      model === "G2++ 2F"
        ? estimateG2Parameters(history)
        : estimateHullWhiteParameters(history),
      { parameterSource: "historical-calibration" as const },
    );
  } catch (error) {
    Object.assign(calibration, {
      fallbackUsed: true,
      fallbackReason: error instanceof Error ? error.message : "Historical calibration failed.",
      calibrationSource: `Governed ${model} fallback parameters`,
    });
  }
  return calibration;
}

type TreasuryObservation = { date: string; values: number[] };
const HISTORY_FIELDS = [
  "BC_3MONTH", "BC_6MONTH", "BC_1YEAR", "BC_2YEAR", "BC_3YEAR",
  "BC_5YEAR", "BC_7YEAR", "BC_10YEAR", "BC_20YEAR", "BC_30YEAR",
];

async function fetchTreasuryHistory(): Promise<TreasuryObservation[]> {
  const year = new Date().getUTCFullYear();
  const observations: TreasuryObservation[] = [];
  for (const requestedYear of [year - 1, year]) {
    const url = new URL("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml");
    url.searchParams.set("data", "daily_treasury_yield_curve");
    url.searchParams.set("field_tdr_date_value", String(requestedYear));
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Treasury history request failed (${response.status})`);
    const xml = await response.text();
    for (const entry of xml.match(/<entry>[\s\S]*?<\/entry>/gi) ?? []) {
      const date = entry.match(/<d:NEW_DATE[^>]*>([^<]+)<\/d:NEW_DATE>/i)?.[1]?.slice(0, 10);
      const values = HISTORY_FIELDS.map((field) =>
        Number(entry.match(new RegExp(`<d:${field}[^>]*>([^<]+)<\\/d:${field}>`, "i"))?.[1]));
      if (date && values.every(Number.isFinite)) observations.push({ date, values });
    }
  }
  const unique = new Map(observations.map((item) => [item.date, item]));
  return [...unique.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function bounded(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fitFactor(values: number[], bounds: [number, number]) {
  const average = mean(values);
  const centered = values.map((value) => value - average);
  let numerator = 0;
  let denominator = 0;
  for (let index = 1; index < centered.length; index += 1) {
    numerator += centered[index - 1] * centered[index];
    denominator += centered[index - 1] ** 2;
  }
  const phi = bounded(denominator > 1e-14 ? numerator / denominator : 0.99, 0.001, 0.99996);
  const meanReversion = bounded(-Math.log(phi) * 252, bounds[0], bounds[1]);
  const decay = Math.exp(-meanReversion / 252);
  const innovations = centered.slice(1).map((value, index) => value - decay * centered[index]);
  return { meanReversion, innovations };
}

function annualizedVolatility(values: number[]) {
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    Math.max(1, values.length - 1);
  return bounded(Math.sqrt(variance * 252), 0.001, 0.10);
}

function diagnostics(observations: TreasuryObservation[]) {
  if (observations.length < 60) throw new Error("At least 60 Treasury curves are required.");
  return {
    observationCount: observations.length,
    calibrationWindowStart: observations[0].date,
    calibrationWindowEnd: observations.at(-1)?.date,
    calibrationSource: "U.S. Treasury daily par-yield curve history",
    fallbackUsed: false,
  };
}

function estimateHullWhiteParameters(observations: TreasuryObservation[]) {
  const base = diagnostics(observations);
  const levels = observations.map((item) => mean(item.values) / 100);
  const fitted = fitFactor(levels, [0.01, 1.50]);
  return {
    ...base,
    meanReversion: fitted.meanReversion,
    volatility: annualizedVolatility(fitted.innovations),
    calibrationObjective: "One-factor AR(1) proxy on curve level",
    parameterBounds: { meanReversion: [0.01, 1.50], volatility: [0.001, 0.10] },
  };
}

function estimateG2Parameters(observations: TreasuryObservation[]) {
  const base = diagnostics(observations);
  const levels = observations.map((item) => mean(item.values) / 100);
  const slopes = observations.map((item) =>
    (mean(item.values.slice(-2)) - mean(item.values.slice(3, 5))) / 100);
  const first = fitFactor(levels, [0.01, 1.50]);
  const second = fitFactor(slopes, [0.01, 2.00]);
  const firstMean = mean(first.innovations);
  const secondMean = mean(second.innovations);
  const covariance = first.innovations.reduce((sum, value, index) =>
    sum + (value - firstMean) * (second.innovations[index] - secondMean), 0);
  const firstSquares = first.innovations.reduce((sum, value) => sum + (value - firstMean) ** 2, 0);
  const secondSquares = second.innovations.reduce((sum, value) => sum + (value - secondMean) ** 2, 0);
  return {
    ...base,
    meanReversion: first.meanReversion,
    volatility: annualizedVolatility(first.innovations),
    secondFactorMeanReversion: second.meanReversion,
    secondFactorVolatility: annualizedVolatility(second.innovations),
    factorCorrelation: bounded(covariance / Math.sqrt(firstSquares * secondSquares), -0.95, 0.95),
    calibrationObjective: "Two-factor AR(1) proxy on curve level and long-end–intermediate slope",
    parameterBounds: {
      meanReversion: [0.01, 1.50],
      volatility: [0.001, 0.10],
      secondFactorMeanReversion: [0.01, 2.00],
      secondFactorVolatility: [0.001, 0.10],
      factorCorrelation: [-0.95, 0.95],
    },
  };
}

async function saveCalibration(db: D1Database, calibration: HullWhiteCalibration) {
  await db.batch([
    db.prepare("UPDATE interest_rate_calibrations SET is_active = 0 WHERE is_active = 1 AND model = ?")
      .bind(calibration.model),
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
      JSON.stringify({
        curve: calibration.curve,
        diagnostics: {
          secondFactorMeanReversion: calibration.secondFactorMeanReversion,
          secondFactorVolatility: calibration.secondFactorVolatility,
          factorCorrelation: calibration.factorCorrelation,
          calibrationSource: calibration.calibrationSource,
          calibrationObjective: calibration.calibrationObjective,
          observationCount: calibration.observationCount,
          calibrationWindowStart: calibration.calibrationWindowStart,
          calibrationWindowEnd: calibration.calibrationWindowEnd,
          parameterBounds: calibration.parameterBounds,
          fallbackUsed: calibration.fallbackUsed,
          fallbackReason: calibration.fallbackReason,
        },
      }),
      calibration.fitRmse,
      calibration.status,
    ),
  ]);
}

async function refresh(db: D1Database, model: RateModelName) {
  const calibration = await fetchTreasuryCurve(model);
  await saveCalibration(db, calibration);
  return calibration;
}

function requestedModel(request: NextRequest): RateModelName {
  return request.nextUrl.searchParams.get("model") === "G2++ 2F" ? "G2++ 2F" : "Hull-White 1F";
}

export async function GET(request: NextRequest) {
  const db = await database();
  await ensureSchema(db);
  const model = requestedModel(request);
  let calibration = await activeCalibration(db, model);
  if (!calibration) calibration = await refresh(db, model);
  return NextResponse.json({
    calibration,
    stale: isHullWhiteStale(calibration),
  });
}

export async function POST(request: NextRequest) {
  try {
    const db = await database();
    await ensureSchema(db);
    const calibration = await refresh(db, requestedModel(request));
    return NextResponse.json({ calibration, stale: false });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to refresh Hull–White calibration." },
      { status: 502 },
    );
  }
}
