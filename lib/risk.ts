export type ModelKind = "historical" | "monteCarlo" | "parametric";

export type Position = {
  id: string;
  symbol: string;
  type: string;
  marketValue: number;
  volatility: number;
  beta: number;
  delta: number;
};

export type Contribution = Position & { amount: number; share: number };

export type HistoricalSeries = {
  symbol: string;
  sourceSymbol: string;
  dates: string[];
  adjustedClose: number[];
};

export type HistoricalData = {
  source: string;
  fetchedAt: string;
  series: HistoricalSeries[];
  mappings: Record<string, string>;
};

export type RiskResult = {
  marketValue: number;
  var: number;
  expectedShortfall: number;
  dailyVolatility: number;
  diversificationBenefit: number;
  observations: number;
  histogram: number[];
  range: number;
  varMarker: number;
  contributions: Contribution[];
  historyStart?: string;
  historyEnd?: string;
  engine?: string;
  runId?: number;
};

export const DEFAULT_POSITIONS: Position[] = [
  { id: "1", symbol: "AAPL", type: "Stock", marketValue: 240000, volatility: 0.29, beta: 1.18, delta: 1 },
  { id: "2", symbol: "SPY", type: "ETF", marketValue: 310000, volatility: 0.18, beta: 1, delta: 1 },
  { id: "3", symbol: "VBTLX", type: "Mutual Fund", marketValue: 180000, volatility: 0.055, beta: 0.08, delta: 1 },
  { id: "4", symbol: "UST10Y", type: "Bond", marketValue: 225000, volatility: 0.075, beta: -0.12, delta: 1 },
  { id: "5", symbol: "AAPL C200", type: "Stock Option", marketValue: 46000, volatility: 0.46, beta: 1.25, delta: 0.62 },
  { id: "6", symbol: "TLT P90", type: "Bond Option", marketValue: 29000, volatility: 0.34, beta: -0.18, delta: -0.41 },
];

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random: () => number) {
  const u = Math.max(random(), Number.EPSILON);
  const v = Math.max(random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function quantile(sorted: number[], probability: number) {
  if (!sorted.length) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(probability * sorted.length) - 1),
  );
  return sorted[index];
}

function inverseNormal(probability: number) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability <= high) {
    const q = probability - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - probability));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

function correlation(left: Position, right: Position) {
  if (left.id === right.id) return 1;
  const systematic = left.beta * right.beta * 0.38;
  const sameClass = left.type.replace(" Option", "") === right.type.replace(" Option", "") ? 0.18 : 0;
  return Math.max(-0.65, Math.min(0.82, systematic + sameClass));
}

function portfolioDailyVolatility(positions: Position[]) {
  let variance = 0;
  for (const left of positions) {
    for (const right of positions) {
      const leftExposure = left.marketValue * left.delta * left.volatility / Math.sqrt(252);
      const rightExposure = right.marketValue * right.delta * right.volatility / Math.sqrt(252);
      variance += leftExposure * rightExposure * correlation(left, right);
    }
  }
  return Math.sqrt(Math.max(variance, 0));
}

function scenarioLosses(positions: Position[], count: number, heavyTails: boolean) {
  const random = mulberry32(20260718 + positions.length * 101);
  const losses: number[] = [];
  for (let scenario = 0; scenario < count; scenario += 1) {
    const marketShock = normal(random);
    let pnl = 0;
    for (const position of positions) {
      const idiosyncraticShock = normal(random);
      let shock = position.beta * marketShock * 0.62 + idiosyncraticShock * Math.sqrt(Math.max(0.08, 1 - Math.min(0.92, position.beta ** 2 * 0.38)));
      if (heavyTails && scenario % 47 === 0) shock *= 1.8;
      const dailyMove = shock * position.volatility / Math.sqrt(252);
      pnl += position.marketValue * position.delta * dailyMove;
    }
    losses.push(-pnl);
  }
  return losses;
}

function historicalLosses(positions: Position[], history: HistoricalData, horizon: number) {
  const seriesBySymbol = new Map(history.series.map((item) => [item.symbol, item]));
  const dateSets = positions
    .map((position) => seriesBySymbol.get(position.symbol)?.dates)
    .filter((dates): dates is string[] => Boolean(dates))
    .map((dates) => new Set(dates));
  if (dateSets.length !== positions.length || !dateSets.length) return { losses: [], dates: [] };

  const commonDates = history.series[0].dates
    .filter((date) => dateSets.every((dates) => dates.has(date)))
    .sort();
  const priceMaps = new Map(
    history.series.map((item) => [
      item.symbol,
      new Map(item.dates.map((date, index) => [date, item.adjustedClose[index]])),
    ]),
  );
  const losses: number[] = [];
  const endingDates: string[] = [];
  for (let index = horizon; index < commonDates.length; index += 1) {
    const start = commonDates[index - horizon];
    const end = commonDates[index];
    let pnl = 0;
    let valid = true;
    for (const position of positions) {
      const prices = priceMaps.get(position.symbol);
      const startPrice = prices?.get(start);
      const endPrice = prices?.get(end);
      if (!startPrice || !endPrice) {
        valid = false;
        break;
      }
      const underlyingReturn = endPrice / startPrice - 1;
      pnl += position.marketValue * position.delta * underlyingReturn;
    }
    if (valid) {
      losses.push(-pnl);
      endingDates.push(end);
    }
  }
  return { losses, dates: endingDates };
}

function sampleDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      (values.length - 1),
  );
}

function buildHistogram(losses: number[], range: number) {
  const bins = Array.from({ length: 31 }, () => 0);
  for (const loss of losses) {
    const normalized = (loss + range) / (2 * range);
    const index = Math.max(0, Math.min(bins.length - 1, Math.floor(normalized * bins.length)));
    bins[index] += 1;
  }
  const maximum = Math.max(...bins, 1);
  return bins.map((value) => value / maximum);
}

export function calculateRisk(
  positions: Position[],
  model: ModelKind,
  confidence: number,
  horizon: number,
  history?: HistoricalData,
): RiskResult {
  const marketValue = positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0) || 1;
  let dailyVolatility = portfolioDailyVolatility(positions);
  const scale = Math.sqrt(horizon);
  let losses: number[];
  let valueAtRisk: number;
  let expectedShortfall: number;
  let observations: number;
  let historyDates: string[] = [];

  if (model === "historical") {
    const historical = history
      ? historicalLosses(positions, history, horizon)
      : { losses: [], dates: [] };
    losses = historical.losses;
    historyDates = historical.dates;
    observations = losses.length;
    const oneDay = history ? historicalLosses(positions, history, 1).losses : [];
    dailyVolatility = sampleDeviation(oneDay);
    const sorted = [...losses].sort((a, b) => a - b);
    valueAtRisk = Math.max(0, quantile(sorted, confidence));
    const tail = sorted.filter((loss) => loss >= valueAtRisk);
    expectedShortfall = tail.reduce((sum, loss) => sum + loss, 0) / Math.max(1, tail.length);
  } else if (model === "parametric") {
    const z = inverseNormal(confidence);
    valueAtRisk = z * dailyVolatility * scale;
    expectedShortfall =
      dailyVolatility * scale *
      (Math.exp(-(z ** 2) / 2) / Math.sqrt(2 * Math.PI)) /
      (1 - confidence);
    losses = scenarioLosses(positions, 2500, false).map((loss) => loss * scale);
    observations = positions.length ** 2;
  } else {
    observations = 10000;
    losses = scenarioLosses(positions, observations, false).map((loss) => loss * scale);
    const sorted = [...losses].sort((a, b) => a - b);
    valueAtRisk = Math.max(0, quantile(sorted, confidence));
    const tail = sorted.filter((loss) => loss >= valueAtRisk);
    expectedShortfall = tail.reduce((sum, loss) => sum + loss, 0) / Math.max(1, tail.length);
  }

  const z = inverseNormal(confidence);
  const standalone = positions.reduce(
    (sum, position) =>
      sum +
      Math.abs(position.marketValue * position.delta) *
        position.volatility /
        Math.sqrt(252) *
        z *
        scale,
    0,
  );
  const rawContributions = positions.map((position) => ({
    ...position,
    amount: Math.abs(position.marketValue * position.delta * position.volatility * (0.35 + Math.abs(position.beta))),
  }));
  const contributionTotal = rawContributions.reduce((sum, item) => sum + item.amount, 0) || 1;
  const contributions = rawContributions
    .map((item) => ({ ...item, share: item.amount / contributionTotal }))
    .sort((left, right) => right.share - left.share);

  const maximumLoss = Math.max(...losses.map(Math.abs), valueAtRisk * 1.3, 1);
  const range = Math.ceil(maximumLoss / 5000) * 5000;
  const varMarker = Math.max(3, Math.min(97, 50 + (valueAtRisk / (2 * range)) * 100));

  return {
    marketValue,
    var: valueAtRisk,
    expectedShortfall,
    dailyVolatility,
    diversificationBenefit: Math.max(0, standalone - valueAtRisk),
    observations,
    histogram: buildHistogram(losses, range),
    range,
    varMarker,
    contributions,
    historyStart: historyDates[0],
    historyEnd: historyDates.at(-1),
  };
}

export function parsePositionsCsv(text: string): Position[] {
  const rows = text.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) throw new Error("CSV must include a header and at least one position.");
  const headers = rows[0].split(",").map((value) => value.trim());
  const required = ["symbol", "type", "marketValue", "volatility", "beta", "delta"];
  if (required.some((name) => !headers.includes(name))) {
    throw new Error(`CSV columns must include: ${required.join(", ")}.`);
  }
  return rows.slice(1).map((row, index) => {
    const values = row.split(",").map((value) => value.trim());
    const record = Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    const position = {
      id: `import-${index}-${record.symbol}`,
      symbol: record.symbol,
      type: record.type,
      marketValue: Number(record.marketValue),
      volatility: Number(record.volatility),
      beta: Number(record.beta),
      delta: Number(record.delta),
    };
    if (!position.symbol || Object.values(position).some((value) => typeof value === "number" && !Number.isFinite(value))) {
      throw new Error(`Invalid values on CSV row ${index + 2}.`);
    }
    return position;
  });
}
