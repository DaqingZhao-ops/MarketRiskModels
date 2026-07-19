export type ModelKind = "historical" | "monteCarlo" | "parametric";

export type Position = {
  id: string;
  symbol: string;
  type: string;
  quantity: number;
  price: number;
  multiplier: number;
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
  { id: "aapl", symbol: "AAPL", type: "Stock", quantity: 100, price: 220, multiplier: 1, marketValue: 22000, volatility: 0.29, beta: 1.18, delta: 1 },
  { id: "amzn", symbol: "AMZN", type: "Stock", quantity: 200, price: 225, multiplier: 1, marketValue: 45000, volatility: 0.32, beta: 1.2, delta: 1 },
  { id: "goog", symbol: "GOOG", type: "Stock", quantity: 150, price: 190, multiplier: 1, marketValue: 28500, volatility: 0.28, beta: 1.05, delta: 1 },
  { id: "meta", symbol: "META", type: "Stock", quantity: 30, price: 700, multiplier: 1, marketValue: 21000, volatility: 0.34, beta: 1.25, delta: 1 },
  { id: "msft", symbol: "MSFT", type: "Stock", quantity: 150, price: 520, multiplier: 1, marketValue: 78000, volatility: 0.25, beta: 1.0, delta: 1 },
  { id: "baba", symbol: "BABA", type: "Stock", quantity: 200, price: 125, multiplier: 1, marketValue: 25000, volatility: 0.4, beta: 0.65, delta: 1 },
  { id: "nvda", symbol: "NVDA", type: "Stock", quantity: 200, price: 180, multiplier: 1, marketValue: 36000, volatility: 0.48, beta: 1.7, delta: 1 },
  { id: "intc", symbol: "INTC", type: "Stock", quantity: 200, price: 30, multiplier: 1, marketValue: 6000, volatility: 0.42, beta: 1.1, delta: 1 },
  { id: "cost", symbol: "COST", type: "Stock", quantity: 200, price: 1000, multiplier: 1, marketValue: 200000, volatility: 0.23, beta: 0.82, delta: 1 },
  { id: "klac", symbol: "KLAC", type: "Stock", quantity: 200, price: 900, multiplier: 1, marketValue: 180000, volatility: 0.38, beta: 1.35, delta: 1 },
  { id: "spy", symbol: "SPY", type: "ETF", quantity: 100, price: 650, multiplier: 1, marketValue: 65000, volatility: 0.18, beta: 1, delta: 1 },
  { id: "schd", symbol: "SCHD", type: "ETF", quantity: 1500, price: 30, multiplier: 1, marketValue: 45000, volatility: 0.16, beta: 0.78, delta: 1 },
  { id: "fagix", symbol: "FAGIX", type: "Mutual Fund", quantity: 2000, price: 9, multiplier: 1, marketValue: 18000, volatility: 0.09, beta: 0.28, delta: 1 },
  { id: "aapl-call", symbol: "AAPL C250", type: "Stock Option", quantity: 10, price: 8.5, multiplier: 100, marketValue: 8500, volatility: 0.48, beta: 1.18, delta: 0.42 },
  { id: "amzn-put", symbol: "AMZN P180", type: "Stock Option", quantity: 8, price: 6.25, multiplier: 100, marketValue: 5000, volatility: 0.52, beta: 1.2, delta: -0.28 },
  { id: "goog-call", symbol: "GOOG C220", type: "Stock Option", quantity: 6, price: 7.5, multiplier: 100, marketValue: 4500, volatility: 0.46, beta: 1.05, delta: 0.36 },
  { id: "meta-put", symbol: "META P600", type: "Stock Option", quantity: 4, price: 18, multiplier: 100, marketValue: 7200, volatility: 0.5, beta: 1.25, delta: -0.31 },
  { id: "msft-call", symbol: "MSFT C600", type: "Stock Option", quantity: 5, price: 12, multiplier: 100, marketValue: 6000, volatility: 0.42, beta: 1, delta: 0.33 },
  { id: "nvda-put", symbol: "NVDA P140", type: "Stock Option", quantity: 10, price: 7.75, multiplier: 100, marketValue: 7750, volatility: 0.62, beta: 1.7, delta: -0.26 },
  { id: "spy-put", symbol: "SPY P600", type: "ETF Option", quantity: 10, price: 11, multiplier: 100, marketValue: 11000, volatility: 0.3, beta: 1, delta: -0.3 },
  { id: "ust2y", symbol: "UST2Y", type: "Bond", quantity: 100000, price: 0.995, multiplier: 1, marketValue: 99500, volatility: 0.02, beta: -0.03, delta: 1 },
  { id: "ust5y", symbol: "UST5Y", type: "Bond", quantity: 150000, price: 0.98, multiplier: 1, marketValue: 147000, volatility: 0.045, beta: -0.08, delta: 1 },
  { id: "ust10y", symbol: "UST10Y", type: "Bond", quantity: 200000, price: 0.96, multiplier: 1, marketValue: 192000, volatility: 0.075, beta: -0.12, delta: 1 },
  { id: "ust20y", symbol: "UST20Y", type: "Bond", quantity: 100000, price: 0.92, multiplier: 1, marketValue: 92000, volatility: 0.12, beta: -0.2, delta: 1 },
  { id: "tlt-call", symbol: "TLT C100", type: "Bond Option", quantity: 20, price: 4.5, multiplier: 100, marketValue: 9000, volatility: 0.32, beta: -0.2, delta: 0.4 },
  { id: "tlt-put", symbol: "TLT P80", type: "Bond Option", quantity: 25, price: 3.2, multiplier: 100, marketValue: 8000, volatility: 0.35, beta: -0.2, delta: -0.32 },
  { id: "ief-put", symbol: "IEF P90", type: "Bond Option", quantity: 20, price: 2.4, multiplier: 100, marketValue: 4800, volatility: 0.2, beta: -0.12, delta: -0.25 },
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
      quantity: Number(record.quantity ?? 0),
      price: Number(record.price ?? 0),
      multiplier: Number(record.multiplier ?? 1),
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
