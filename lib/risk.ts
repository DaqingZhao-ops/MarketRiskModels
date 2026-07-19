import {
  hullWhiteBondOption,
  hullWhiteDiscountFactor,
  type HullWhiteCalibration,
} from "./hull-white.ts";

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
  marketPrice?: number;
  marketPriceAt?: string;
  marketPriceSource?: "market" | "black-scholes" | "treasury-curve" | "hull-white";
  riskSource?: "provided" | "historical-pending" | "historical" | "fallback";
};

export type Contribution = Position & { amount: number; share: number };

export type HistoricalSeries = {
  symbol: string;
  sourceSymbol: string;
  dates: string[];
  adjustedClose: number[];
  latestPrice?: number;
  latestPriceAt?: string;
  currency?: string;
};

export type HistoricalData = {
  source: string;
  fetchedAt: string;
  series: HistoricalSeries[];
  mappings: Record<string, string>;
  treasuryCurve?: {
    asOf: string;
    yields: Record<string, number>;
  };
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

export type FrontierPoint = {
  risk: number;
  return: number;
};

export type EfficientFrontierResult = {
  cloud: FrontierPoint[];
  frontier: FrontierPoint[];
  current: FrontierPoint & { sharpe: number };
  assetCount: number;
  observations: number;
  excluded: string[];
  recommendations: Array<{
    symbol: string;
    action: "Increase" | "Reduce";
    currentWeight: number;
    targetWeight: number;
    change: number;
  }>;
  allocationAlternatives: Array<{
    name: string;
    description: string;
    point: FrontierPoint & { sharpe: number };
    turnover: number;
    changes: Array<{
      symbol: string;
      currentWeight: number;
      proposedWeight: number;
      change: number;
    }>;
  }>;
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
  { id: "tlt-call", symbol: "TLT C100", type: "ETF Option", quantity: 20, price: 4.5, multiplier: 100, marketValue: 9000, volatility: 0.32, beta: -0.2, delta: 0.4 },
  { id: "tlt-put", symbol: "TLT P80", type: "ETF Option", quantity: 25, price: 3.2, multiplier: 100, marketValue: 8000, volatility: 0.35, beta: -0.2, delta: -0.32 },
  { id: "ief-put", symbol: "IEF P90", type: "ETF Option", quantity: 20, price: 2.4, multiplier: 100, marketValue: 4800, volatility: 0.2, beta: -0.12, delta: -0.25 },
].map((position) => ({ ...position, riskSource: "historical-pending" }));

export function enrichPositionsWithHistoricalRisk(
  positions: Position[],
  history: HistoricalData,
  asOf = new Date(),
  rateCalibration?: HullWhiteCalibration,
) {
  const benchmark = history.series.find((item) => item.symbol === "SPY");
  return positions.map((position) => {
    if (!["historical-pending", "fallback"].includes(position.riskSource ?? "")) return position;
    const series = history.series.find((item) => item.symbol === position.symbol);
    if (!series || series.adjustedClose.length < 30) {
      return { ...position, riskSource: "fallback" as const };
    }
    const returns = dailyReturns(series);
    const volatility = historicalDeviation(returns.map((item) => item.value)) * Math.sqrt(252);
    const beta = benchmark ? historicalBeta(series, benchmark) : position.beta;
    const underlyingPrice = series.latestPrice ?? series.adjustedClose.at(-1) ?? 0;
    const hullWhiteOption = position.type === "Bond Option" && rateCalibration
      ? modelHullWhiteBondOption(position.symbol, rateCalibration)
      : undefined;
    const optionDelta = position.type.endsWith("Option")
      ? blackScholesDelta(position.symbol, underlyingPrice, volatility, asOf)
      : 1;
    const canRefreshPrice = ["Stock", "ETF", "Mutual Fund"].includes(position.type) &&
      typeof series.latestPrice === "number" && Number.isFinite(series.latestPrice) &&
      series.latestPrice > 0;
    const modeledOptionPrice = ["Stock Option", "ETF Option"].includes(position.type)
      ? blackScholesPrice(position.symbol, underlyingPrice, volatility, asOf)
      : undefined;
    const hasModeledOptionPrice = typeof modeledOptionPrice === "number" &&
      Number.isFinite(modeledOptionPrice) && modeledOptionPrice >= 0;
    const treasuryModelPrice = position.type === "Bond"
      ? modelTreasuryPrice(
          position.symbol,
          rateCalibration,
          history.treasuryCurve?.yields[position.symbol],
        )
      : undefined;
    const hasTreasuryModelPrice = typeof treasuryModelPrice === "number" &&
      Number.isFinite(treasuryModelPrice) && treasuryModelPrice > 0;
    const latestPrice = canRefreshPrice
      ? series.latestPrice as number
      : hasModeledOptionPrice
        ? modeledOptionPrice
        : hullWhiteOption
          ? hullWhiteOption.price
        : hasTreasuryModelPrice
          ? treasuryModelPrice
          : position.price;
    return {
      ...position,
      price: latestPrice,
      marketPrice: canRefreshPrice || hasModeledOptionPrice || hullWhiteOption || hasTreasuryModelPrice
        ? latestPrice
        : undefined,
      marketPriceAt: hasTreasuryModelPrice
        ? history.treasuryCurve?.asOf
        : canRefreshPrice || hasModeledOptionPrice || hullWhiteOption
          ? series.latestPriceAt
          : undefined,
      marketPriceSource: canRefreshPrice
        ? "market"
        : hasModeledOptionPrice
          ? "black-scholes"
          : hullWhiteOption
            ? "hull-white"
          : hasTreasuryModelPrice
            ? "treasury-curve"
            : undefined,
      marketValue: Math.abs(position.quantity * latestPrice * position.multiplier),
      volatility: Number.isFinite(volatility) && volatility > 0 ? volatility : position.volatility,
      beta: Number.isFinite(beta) ? beta : position.beta,
      delta: hullWhiteOption?.delta ?? optionDelta ?? position.delta,
      riskSource: "historical" as const,
    };
  });
}

function modelHullWhiteBondOption(
  symbol: string,
  calibration: HullWhiteCalibration,
) {
  const terms = symbol.trim().toUpperCase()
    .match(/^UST(2|5|10|20)Y\s+([CP])(\d+(?:\.\d+)?)$/);
  if (!terms) return undefined;
  return hullWhiteBondOption(
    calibration,
    90 / 365.25,
    Number(terms[1]),
    Number(terms[3]),
    terms[2] as "C" | "P",
  );
}

function modelTreasuryPrice(
  symbol: string,
  calibration?: HullWhiteCalibration,
  annualYield?: number,
) {
  const maturity = { UST2Y: 2, UST5Y: 5, UST10Y: 10, UST20Y: 20 }[symbol];
  if (!maturity) return undefined;
  const hullWhitePrice = calibration
    ? hullWhiteDiscountFactor(calibration, maturity)
    : undefined;
  if (hullWhitePrice !== undefined) return hullWhitePrice;
  if (annualYield === undefined || annualYield <= 0) return undefined;
  return 1 / (1 + annualYield / 2) ** (maturity * 2);
}

function dailyReturns(series: HistoricalSeries) {
  return series.adjustedClose.slice(1).map((price, index) => ({
    date: series.dates[index + 1],
    value: price / series.adjustedClose[index] - 1,
  })).filter((item) => Number.isFinite(item.value));
}

function historicalDeviation(values: number[]) {
  if (values.length < 2) return Number.NaN;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function historicalBeta(asset: HistoricalSeries, benchmark: HistoricalSeries) {
  const benchmarkReturns = new Map(dailyReturns(benchmark).map((item) => [item.date, item.value]));
  const pairs = dailyReturns(asset)
    .filter((item) => benchmarkReturns.has(item.date))
    .map((item) => [item.value, benchmarkReturns.get(item.date) ?? 0]);
  if (pairs.length < 30) return Number.NaN;
  const assetMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const marketMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  const covariance = pairs.reduce(
    (sum, pair) => sum + (pair[0] - assetMean) * (pair[1] - marketMean),
    0,
  ) / (pairs.length - 1);
  const variance = pairs.reduce((sum, pair) => sum + (pair[1] - marketMean) ** 2, 0) / (pairs.length - 1);
  return variance > 0 ? covariance / variance : Number.NaN;
}

function optionTerms(symbol: string, asOf: Date) {
  const compact = symbol.replace(/^[+-]/, "").replace(/\s/g, "");
  const occ = compact.match(/^[A-Z]{1,6}(\d{6})([CP])(\d{8})$/i);
  if (occ) {
    const [, date, callPut, strikeDigits] = occ;
    const expiration = new Date(
      Date.UTC(2000 + Number(date.slice(0, 2)), Number(date.slice(2, 4)) - 1, Number(date.slice(4, 6)), 21),
    );
    return {
      callPut: callPut.toUpperCase(),
      strike: Number(strikeDigits) / 1000,
      years: Math.max((expiration.getTime() - asOf.getTime()) / (365.25 * 86400000), 1 / 365.25),
    };
  }
  const simple = symbol.trim().match(/^[A-Z]{1,6}\s+([CP])(\d+(?:\.\d+)?)$/i);
  if (!simple) return undefined;
  return { callPut: simple[1].toUpperCase(), strike: Number(simple[2]), years: 90 / 365.25 };
}

function blackScholesInputs(symbol: string, spot: number, volatility: number, asOf: Date) {
  const terms = optionTerms(symbol, asOf);
  if (!terms || spot <= 0 || volatility <= 0 || terms.strike <= 0) return undefined;
  const { callPut, strike, years } = terms;
  const d1 = (Math.log(spot / strike) + (0.043 + volatility ** 2 / 2) * years) /
    (volatility * Math.sqrt(years));
  const d2 = d1 - volatility * Math.sqrt(years);
  return { callPut, strike, years, d1, d2 };
}

function blackScholesDelta(symbol: string, spot: number, volatility: number, asOf: Date) {
  const inputs = blackScholesInputs(symbol, spot, volatility, asOf);
  if (!inputs) return undefined;
  const { callPut, d1 } = inputs;
  const callDelta = normalCdf(d1);
  return callPut === "P" ? callDelta - 1 : callDelta;
}

function blackScholesPrice(symbol: string, spot: number, volatility: number, asOf: Date) {
  const inputs = blackScholesInputs(symbol, spot, volatility, asOf);
  if (!inputs) return undefined;
  const { callPut, strike, years, d1, d2 } = inputs;
  const discountedStrike = strike * Math.exp(-0.043 * years);
  return callPut === "C"
    ? spot * normalCdf(d1) - discountedStrike * normalCdf(d2)
    : discountedStrike * normalCdf(-d2) - spot * normalCdf(-d1);
}

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
    0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

export function calculateEfficientFrontier(
  positions: Position[],
  history?: HistoricalData,
): EfficientFrontierResult | undefined {
  if (!history) return undefined;
  const heldSources = new Set(
    positions
      .map((position) => history.mappings[position.symbol])
      .filter((source): source is string => Boolean(source)),
  );
  const uniqueSeries = [...new Map(
    history.series
      .filter((series) =>
        heldSources.has(series.sourceSymbol) &&
        series.adjustedClose.length >= 60)
      .map((series) => [series.sourceSymbol, series]),
  ).values()];
  if (uniqueSeries.length < 2) return undefined;

  const commonDates = uniqueSeries[0].dates.filter((date) =>
    uniqueSeries.every((series) => series.dates.includes(date)));
  if (commonDates.length < 60) return undefined;
  const returnsByAsset = uniqueSeries.map((series) => {
    const prices = new Map(series.dates.map((date, index) => [date, series.adjustedClose[index]]));
    return commonDates.slice(1).map((date, index) => {
      const previous = prices.get(commonDates[index]) ?? 0;
      return (prices.get(date) ?? previous) / previous - 1;
    });
  });
  const means = returnsByAsset.map((returns) =>
    returns.reduce((sum, value) => sum + value, 0) / returns.length * 252);
  const covariance = returnsByAsset.map((left, leftIndex) =>
    returnsByAsset.map((right, rightIndex) => {
      const leftDailyMean = means[leftIndex] / 252;
      const rightDailyMean = means[rightIndex] / 252;
      return left.reduce(
        (sum, value, index) =>
          sum + (value - leftDailyMean) * (right[index] - rightDailyMean),
        0,
      ) / (left.length - 1) * 252;
    }));

  const pointFor = (weights: number[]): FrontierPoint => {
    const expectedReturn = weights.reduce((sum, weight, index) => sum + weight * means[index], 0);
    const variance = weights.reduce((outer, leftWeight, leftIndex) =>
      outer + weights.reduce((inner, rightWeight, rightIndex) =>
        inner + leftWeight * rightWeight * covariance[leftIndex][rightIndex], 0), 0);
    return { risk: Math.sqrt(Math.max(variance, 0)), return: expectedReturn };
  };

  const random = mulberry32(20260719 + uniqueSeries.length * 17);
  const portfolios: FrontierPoint[] = [];
  let maxSharpeWeights = uniqueSeries.map(() => 1 / uniqueSeries.length);
  let maxSharpe = -Infinity;
  for (let iteration = 0; iteration < 5000; iteration += 1) {
    const raw = uniqueSeries.map(() => -Math.log(Math.max(random(), Number.EPSILON)));
    const total = raw.reduce((sum, value) => sum + value, 0);
    const weights = raw.map((value) => value / total);
    const point = pointFor(weights);
    portfolios.push(point);
    const sharpe = point.risk > 0 ? (point.return - 0.043) / point.risk : -Infinity;
    if (sharpe > maxSharpe) {
      maxSharpe = sharpe;
      maxSharpeWeights = weights;
    }
  }
  uniqueSeries.forEach((_, index) => {
    const weights = uniqueSeries.map((__, assetIndex) => assetIndex === index ? 1 : 0);
    const point = pointFor(weights);
    portfolios.push(point);
    const sharpe = point.risk > 0 ? (point.return - 0.043) / point.risk : -Infinity;
    if (sharpe > maxSharpe) {
      maxSharpe = sharpe;
      maxSharpeWeights = weights;
    }
  });
  const sorted = [...portfolios].sort((left, right) => left.risk - right.risk || right.return - left.return);
  const frontier: FrontierPoint[] = [];
  let bestReturn = -Infinity;
  for (const point of sorted) {
    if (point.return > bestReturn + 0.00025) {
      frontier.push(point);
      bestReturn = point.return;
    }
  }

  const sourceIndex = new Map(uniqueSeries.map((series, index) => [series.sourceSymbol, index]));
  const currentWeights = uniqueSeries.map(() => 0);
  const totalMarketValue = positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0) || 1;
  const excluded: string[] = [];
  for (const position of positions) {
    const source = history.mappings[position.symbol];
    const index = sourceIndex.get(source);
    if (index === undefined) {
      excluded.push(position.symbol);
    } else {
      currentWeights[index] += directionalExposure(position) / totalMarketValue;
    }
  }
  const riskFreeRate = 0.043;
  const positiveWeightTotal = currentWeights.reduce(
    (sum, weight) => sum + Math.max(weight, 0),
    0,
  );
  const allocationBaseWeights = positiveWeightTotal > 0
    ? currentWeights.map((weight) => Math.max(weight, 0) / positiveWeightTotal)
    : currentWeights.map(() => 1 / currentWeights.length);
  const currentPoint = pointFor(allocationBaseWeights);
  const recommendations = uniqueSeries
    .map((series, index) => {
      const change = maxSharpeWeights[index] - allocationBaseWeights[index];
      return {
        symbol: series.sourceSymbol,
        action: (change >= 0 ? "Increase" : "Reduce") as "Increase" | "Reduce",
        currentWeight: allocationBaseWeights[index],
        targetWeight: maxSharpeWeights[index],
        change,
      };
    })
    .sort((left, right) => Math.abs(right.change) - Math.abs(left.change))
    .slice(0, 5);
  const alternativeRandom = mulberry32(20260723 + uniqueSeries.length * 31);
  const alternativeCandidates = Array.from({ length: 96 }, (_, candidateIndex) => {
    const randomRaw = uniqueSeries.map(() =>
      -Math.log(Math.max(alternativeRandom(), Number.EPSILON)));
    const randomTotal = randomRaw.reduce((sum, weight) => sum + weight, 0);
    const randomWeights = randomRaw.map((weight) => weight / randomTotal);
    const weights = allocationBaseWeights.map((weight, index) =>
      weight * 0.87 + maxSharpeWeights[index] * 0.10 + randomWeights[index] * 0.03);
    const point = pointFor(weights);
    return {
      candidateIndex,
      weights,
      point,
      sharpe: point.risk > 0 ? (point.return - riskFreeRate) / point.risk : -Infinity,
    };
  }).sort((left, right) => right.sharpe - left.sharpe);
  const selectedAlternatives = [
    alternativeCandidates[0],
    alternativeCandidates.find((candidate) =>
      candidate.candidateIndex !== alternativeCandidates[0].candidateIndex &&
      candidate.weights.some((weight, index) =>
        Math.abs(weight - alternativeCandidates[0].weights[index]) > 0.0005)) ??
      alternativeCandidates[1],
  ];
  const alternativeNames = [
    {
      name: "Measured improvement",
      description: "A 10% frontier tilt plus a 3% randomized diversification sleeve.",
    },
    {
      name: "Diversified improvement",
      description: "The same 13% change budget with a different randomized sleeve.",
    },
  ];
  const allocationAlternatives = selectedAlternatives.map((candidate, alternativeIndex) => ({
    ...alternativeNames[alternativeIndex],
    point: { ...candidate.point, sharpe: candidate.sharpe },
    turnover: candidate.weights.reduce(
      (sum, weight, index) => sum + Math.abs(weight - allocationBaseWeights[index]),
      0,
    ) / 2,
    changes: uniqueSeries
      .map((series, index) => ({
        symbol: series.sourceSymbol,
        currentWeight: allocationBaseWeights[index],
        proposedWeight: candidate.weights[index],
        change: candidate.weights[index] - allocationBaseWeights[index],
      }))
      .sort((left, right) => Math.abs(right.change) - Math.abs(left.change))
      .slice(0, 5),
  }));
  return {
    cloud: portfolios.filter((_, index) => index % 14 === 0).slice(0, 400),
    frontier,
    current: {
      ...currentPoint,
      sharpe: currentPoint.risk > 0 ? (currentPoint.return - riskFreeRate) / currentPoint.risk : 0,
    },
    assetCount: uniqueSeries.length,
    observations: commonDates.length - 1,
    excluded: [...new Set(excluded)],
    recommendations,
    allocationAlternatives,
  };
}

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

function directionalExposure(position: Position) {
  const quantityDirection = position.quantity < 0 ? -1 : 1;
  return quantityDirection * position.marketValue * position.delta;
}

function portfolioDailyVolatility(positions: Position[]) {
  let variance = 0;
  for (const left of positions) {
    for (const right of positions) {
      const leftExposure = directionalExposure(left) * left.volatility / Math.sqrt(252);
      const rightExposure = directionalExposure(right) * right.volatility / Math.sqrt(252);
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
      pnl += directionalExposure(position) * dailyMove;
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
      pnl += directionalExposure(position) * underlyingReturn;
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
      riskSource: nativeFormat ? "provided" : "historical-pending",
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
    if (/\b(etf|spy|qqq|schd|tlt|ief|shy|iei)\b/.test(context)) return "ETF Option";
    if (/\b(treasury|bond)\b/.test(context)) return "Bond Option";
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
