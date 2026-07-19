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
  const rows = parseCsvRows(text);
  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return normalized.includes("symbol") &&
      normalized.some((header) => ["quantity", "shares"].includes(header));
  });
  if (headerIndex < 0) {
    throw new Error("No Schwab, Fidelity, or Market Risk Models position header was found.");
  }
  const headers = rows[headerIndex].map(normalizeHeader);
  const nativeFormat = headers.includes("volatility") && headers.includes("beta") && headers.includes("delta");
  const positions = rows.slice(headerIndex + 1).flatMap((values, index) => {
    const record = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]));
    const symbol = field(record, "symbol").trim();
    const description = field(record, "description", "name", "securitydescription");
    if (!symbol || /^(cash|pending activity|total|account total|--?)$/i.test(symbol) ||
        /money market|cash & cash investments|account total/i.test(description)) return [];
    const quantity = parseBrokerNumber(field(record, "quantity", "shares"));
    const price = parseBrokerNumber(field(record, "price", "lastprice", "currentprice", "mostrecentprice", "marketprice"));
    const suppliedValue = parseBrokerNumber(field(record, "marketvalue", "currentvalue", "mostrecentvalue", "value"));
    if (!Number.isFinite(quantity) || quantity === 0) return [];
    const type = nativeFormat
      ? field(record, "type") || inferInstrumentType(symbol, description)
      : inferInstrumentType(symbol, description, field(record, "type", "securitytype"));
    const defaults = riskDefaults(type, symbol, description);
    const multiplier = nativeFormat
      ? parseBrokerNumber(field(record, "multiplier")) || defaults.multiplier
      : defaults.multiplier;
    const marketValue = Number.isFinite(suppliedValue) && suppliedValue !== 0
      ? Math.abs(suppliedValue)
      : Math.abs(quantity * price * multiplier);
    const position: Position = {
      id: `import-${index}-${symbol}`,
      symbol,
      type,
      quantity,
      price: Number.isFinite(price) ? price : marketValue / Math.abs(quantity * multiplier),
      multiplier,
      marketValue,
      volatility: nativeFormat ? parseBrokerNumber(field(record, "volatility")) : defaults.volatility,
      beta: nativeFormat ? parseBrokerNumber(field(record, "beta")) : defaults.beta,
      delta: nativeFormat ? parseBrokerNumber(field(record, "delta")) : defaults.delta,
    };
    if (Object.values(position).some((value) => typeof value === "number" && !Number.isFinite(value))) {
      throw new Error(`Invalid values on CSV row ${headerIndex + index + 2}.`);
    }
    return [position];
  });
  if (!positions.length) throw new Error("The CSV did not contain any supported investment positions.");
  return positions;
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(value: string) {
  return value.replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function field(record: Record<string, string>, ...names: string[]) {
  return names.map((name) => record[normalizeHeader(name)]).find((value) => value?.trim()) ?? "";
}

function parseBrokerNumber(value: string) {
  const normalized = value.trim()
    .replace(/^\((.*)\)$/, "-$1")
    .replace(/[$,%+\s]/g, "")
    .replace(/--?$/, "");
  return normalized ? Number(normalized) : Number.NaN;
}

function inferInstrumentType(symbol: string, description: string, suppliedType = "") {
  const context = `${symbol} ${description} ${suppliedType}`.toLowerCase();
  const option = /\b(call|put|option)\b/.test(context) ||
    /[a-z]{1,6}\d{6}[cp]\d{8}$/i.test(symbol.replace(/\s/g, ""));
  if (option) {
    if (/\b(treasury|bond|tlt|ief|shy|iei)\b/.test(context)) return "Bond Option";
    if (/\b(etf|spy|qqq|schd|tlt|ief|shy|iei)\b/.test(context)) return "ETF Option";
    return "Stock Option";
  }
  if (/\b(treasury|treasury note|treasury bond|fixed income|bond)\b/.test(context)) return "Bond";
  if (/\b(mutual fund|fund shares)\b/.test(context) || /^[A-Z]{5}$/.test(symbol)) return "Mutual Fund";
  if (/\b(etf|exchange traded)\b/.test(context) || /^(SPY|QQQ|SCHD|TLT|IEF|SHY|IEI)$/i.test(symbol)) return "ETF";
  return "Stock";
}

function riskDefaults(type: string, symbol: string, description: string) {
  const isPut = /\bput\b/i.test(`${symbol} ${description}`) ||
    /\d{6}p\d{8}$/i.test(symbol.replace(/\s/g, ""));
  if (type === "Bond Option") return { multiplier: 100, volatility: 0.25, beta: -0.12, delta: isPut ? -0.3 : 0.3 };
  if (type.endsWith("Option")) return { multiplier: 100, volatility: 0.45, beta: 1, delta: isPut ? -0.35 : 0.35 };
  if (type === "Bond") return { multiplier: 1, volatility: 0.07, beta: -0.1, delta: 1 };
  if (type === "Mutual Fund") return { multiplier: 1, volatility: 0.16, beta: 0.75, delta: 1 };
  if (type === "ETF") return { multiplier: 1, volatility: 0.2, beta: 1, delta: 1 };
  return { multiplier: 1, volatility: 0.3, beta: 1, delta: 1 };
}
