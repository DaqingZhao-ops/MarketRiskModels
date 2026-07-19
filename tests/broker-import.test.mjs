import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateEfficientFrontier,
  calculateRisk,
  enrichPositionsWithHistoricalRisk,
  parsePositionsCsv,
} from "../lib/risk.ts";
import {
  fitHullWhiteCurve,
  hullWhiteBondOption,
  hullWhiteDiscountFactor,
  isHullWhiteStale,
} from "../lib/hull-white.ts";

test("imports a Fidelity positions export", () => {
  const csv = `Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Type
Z12345678,Brokerage,AAPL,"APPLE INC",100,$220.00,"$22,000.00",Cash
Z12345678,Brokerage,-AAPL260116P00200000,"PUT AAPL 01/16/26 200",2,$5.50,"$1,100.00",Cash
Z12345678,Brokerage,SPAXX,"FIDELITY GOVERNMENT MONEY MARKET",5000,$1.00,"$5,000.00",Cash
`;
  const positions = parsePositionsCsv(csv);
  assert.equal(positions.length, 2);
  assert.deepEqual(
    positions.map(({ symbol, quantity, price, marketValue, type, multiplier }) =>
      ({ symbol, quantity, price, marketValue, type, multiplier })),
    [
      { symbol: "AAPL", quantity: 100, price: 220, marketValue: 22000, type: "Stock", multiplier: 1 },
      { symbol: "-AAPL260116P00200000", quantity: 2, price: 5.5, marketValue: 1100, type: "Stock Option", multiplier: 100 },
    ],
  );
  assert.equal(positions[1].delta, -0.35);
});

test("imports a Schwab positions export with preamble and quoted values", () => {
  const csv = `Positions for account XXXX-1234 as of 07/19/2026

Symbol,Description,Quantity,Price,Market Value,Security Type
SCHD,SCHWAB US DIVIDEND EQUITY ETF,1500,$30.00,"$45,000.00",ETF
91282CJL6,"US TREASURY NOTE, 4.25%, 06/30/2031",100000,$98.50,"$98,500.00",Fixed Income
Account Total,,,,"$143,500.00",
`;
  const positions = parsePositionsCsv(csv);
  assert.equal(positions.length, 2);
  assert.equal(positions[0].type, "ETF");
  assert.equal(positions[1].type, "Bond");
  assert.equal(positions[1].quantity, 100000);
  assert.equal(positions[1].marketValue, 98500);
});

test("imports a Schwab export that uses Qty and Mkt Value headers", () => {
  const csv = `Positions for account XXXX-1234 as of 07/19/2026

Symbol,Description,Qty,Price,Price Change,Mkt Value,Security Type
AAPL,APPLE INC,100,$220.00,+$1.25,"$22,000.00",Equity
SPY  260918P00600000,SPY 09/18/2026 600.00 P,2,$8.50,-$0.20,"$1,700.00",Option
Account Total,,,,,"$23,700.00",
`;
  const positions = parsePositionsCsv(csv);
  assert.equal(positions.length, 2);
  assert.deepEqual(
    positions.map(({ symbol, quantity, marketValue, type }) =>
      ({ symbol, quantity, marketValue, type })),
    [
      { symbol: "AAPL", quantity: 100, marketValue: 22000, type: "Stock" },
      { symbol: "SPY  260918P00600000", quantity: 2, marketValue: 1700, type: "ETF Option" },
    ],
  );
});

test("imports Schwab compound headers from the Individual Positions export", () => {
  const csv = `"Positions for account Individual ...258 as of 02:14 PM ET, 2026/07/19"

"Symbol","Description","Price","Qty (Quantity)","Price Chng % (Price Change %)","Mkt Val (Market Value)","Asset Type",
"EFX","EQUIFAX INC","177.08","100","-1.41%","$17,708.00","Equity",
"SPY","STATE STREET SPDR S&P 500 ETF TRUST","743.29","368","-0.99%","$273,530.72","ETFs & Closed End Funds",
"VGHCX","VANGUARD HEALTH CARE INV","203.83","1,050.568","-0.47%","$214,137.28","Mutual Fund",
"SWVXX","SCHWAB PRIME ADVANTAGE MONEY INVESTOR","1.00","8,025.15","0%","$8,025.15","Cash and Money Market",
`;
  const positions = parsePositionsCsv(csv);
  assert.deepEqual(
    positions.map(({ symbol, quantity, marketValue, type }) =>
      ({ symbol, quantity, marketValue, type })),
    [
      { symbol: "EFX", quantity: 100, marketValue: 17708, type: "Stock" },
      { symbol: "SPY", quantity: 368, marketValue: 273530.72, type: "ETF" },
      { symbol: "VGHCX", quantity: 1050.568, marketValue: 214137.28, type: "Mutual Fund" },
    ],
  );
});

test("continues to import the native app format", () => {
  const csv = `symbol,type,quantity,price,multiplier,marketValue,volatility,beta,delta
AAPL,Stock,100,220,1,22000,0.29,1.18,1`;
  const [position] = parsePositionsCsv(csv);
  assert.equal(position.volatility, 0.29);
  assert.equal(position.beta, 1.18);
});

test("calculates missing broker risk factors from historical prices", () => {
  const [position] = parsePositionsCsv(
    "Symbol,Description,Quantity,Price,Market Value\nAAPL,APPLE INC,100,$220,\"$22,000\"",
  );
  const dates = Array.from({ length: 61 }, (_, index) =>
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10));
  const marketReturns = Array.from({ length: 60 }, (_, index) => index % 2 ? -0.006 : 0.008);
  const prices = (returns, start) =>
    returns.reduce((values, value) => [...values, values.at(-1) * (1 + value)], [start]);
  const history = {
    source: "test",
    fetchedAt: "2026-03-02T00:00:00Z",
    mappings: { AAPL: "AAPL", SPY: "SPY" },
    series: [
      { symbol: "AAPL", sourceSymbol: "AAPL", dates, adjustedClose: prices(marketReturns.map((value) => value * 2), 100), latestPrice: 250 },
      { symbol: "SPY", sourceSymbol: "SPY", dates, adjustedClose: prices(marketReturns, 500) },
    ],
  };
  const [enriched] = enrichPositionsWithHistoricalRisk([position], history);
  assert.equal(enriched.riskSource, "historical");
  assert.ok(enriched.volatility > 0);
  assert.ok(Math.abs(enriched.beta - 2) < 1e-10);
  assert.equal(enriched.price, 250);
  assert.equal(enriched.marketPrice, 250);
  assert.equal(enriched.marketValue, 25000);
});

test("uses a labeled Black-Scholes fallback for simplified stock options", () => {
  const dates = Array.from({ length: 61 }, (_, index) =>
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10));
  const adjustedClose = Array.from({ length: 61 }, (_, index) =>
    220 * (1 + index * 0.0005 + Math.sin(index) * 0.01));
  const option = {
    id: "option",
    symbol: "AAPL C250",
    type: "Stock Option",
    quantity: 10,
    price: 8.5,
    multiplier: 100,
    marketValue: 8500,
    volatility: 0.4,
    beta: 1,
    delta: 0.4,
    riskSource: "historical-pending",
  };
  const [enriched] = enrichPositionsWithHistoricalRisk([option], {
    source: "test",
    fetchedAt: "2026-03-02T00:00:00Z",
    mappings: { "AAPL C250": "AAPL", SPY: "SPY" },
    series: [
      { symbol: "AAPL C250", sourceSymbol: "AAPL", dates, adjustedClose, latestPrice: 225, latestPriceAt: "2026-03-02T21:00:00Z" },
      { symbol: "SPY", sourceSymbol: "SPY", dates, adjustedClose: adjustedClose.map((price) => price * 2) },
    ],
  }, new Date("2026-03-02T00:00:00Z"));
  assert.equal(enriched.marketPriceSource, "black-scholes");
  assert.ok(enriched.marketPrice > 0);
  assert.equal(enriched.price, enriched.marketPrice);
  assert.ok(enriched.delta > 0 && enriched.delta < 1);
});

test("uses the Black-Scholes fallback for SPY ETF options", () => {
  const dates = Array.from({ length: 61 }, (_, index) =>
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10));
  const adjustedClose = Array.from({ length: 61 }, (_, index) =>
    620 * (1 + index * 0.0004 + Math.sin(index) * 0.006));
  const option = {
    id: "spy-put",
    symbol: "SPY P600",
    type: "ETF Option",
    quantity: 10,
    price: 11,
    multiplier: 100,
    marketValue: 11000,
    volatility: 0.3,
    beta: 1,
    delta: -0.3,
    riskSource: "historical-pending",
  };
  const [enriched] = enrichPositionsWithHistoricalRisk([option], {
    source: "test",
    fetchedAt: "2026-03-02T00:00:00Z",
    mappings: { "SPY P600": "SPY", SPY: "SPY" },
    series: [
      { symbol: "SPY P600", sourceSymbol: "SPY", dates, adjustedClose, latestPrice: 625, latestPriceAt: "2026-03-02T21:00:00Z" },
      { symbol: "SPY", sourceSymbol: "SPY", dates, adjustedClose, latestPrice: 625 },
    ],
  }, new Date("2026-03-02T00:00:00Z"));
  assert.equal(enriched.marketPriceSource, "black-scholes");
  assert.ok(enriched.marketPrice > 0);
  assert.ok(enriched.delta < 0 && enriched.delta > -1);
});

test("uses the official Treasury curve as a labeled generic bond fallback", () => {
  const dates = Array.from({ length: 61 }, (_, index) =>
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10));
  const adjustedClose = Array.from({ length: 61 }, (_, index) => 95 + Math.sin(index) * 0.5);
  const bond = {
    id: "ust10y",
    symbol: "UST10Y",
    type: "Bond",
    quantity: 200000,
    price: 0.96,
    multiplier: 1,
    marketValue: 192000,
    volatility: 0.075,
    beta: -0.12,
    delta: 1,
    riskSource: "historical-pending",
  };
  const [enriched] = enrichPositionsWithHistoricalRisk([bond], {
    source: "test",
    fetchedAt: "2026-07-17T00:00:00Z",
    mappings: { UST10Y: "IEF", SPY: "SPY" },
    series: [
      { symbol: "UST10Y", sourceSymbol: "IEF", dates, adjustedClose },
      { symbol: "SPY", sourceSymbol: "SPY", dates, adjustedClose: adjustedClose.map((price) => price * 5) },
    ],
    treasuryCurve: {
      asOf: "2026-07-17T00:00:00Z",
      yields: { UST2Y: 0.04, UST5Y: 0.041, UST10Y: 0.043, UST20Y: 0.048 },
    },
  });
  assert.equal(enriched.marketPriceSource, "treasury-curve");
  assert.ok(enriched.marketPrice > 0 && enriched.marketPrice < 1);
  assert.equal(enriched.marketPriceAt, "2026-07-17T00:00:00Z");
  assert.equal(enriched.price, enriched.marketPrice);
});

test("builds an efficient frontier and locates the current portfolio", () => {
  const dates = Array.from({ length: 91 }, (_, index) =>
    new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10));
  const seriesFor = (symbol, start, phase, drift) => {
    const prices = [start];
    for (let index = 1; index < dates.length; index += 1) {
      const dailyReturn = drift + Math.sin(index * 0.61 + phase) * 0.008;
      prices.push(prices.at(-1) * (1 + dailyReturn));
    }
    return { symbol, sourceSymbol: symbol, dates, adjustedClose: prices };
  };
  const positions = [
    { id: "a", symbol: "AAA", type: "Stock", quantity: 10, price: 100, multiplier: 1, marketValue: 1000, volatility: 0.2, beta: 1, delta: 1 },
    { id: "b", symbol: "BBB", type: "Stock", quantity: 10, price: 100, multiplier: 1, marketValue: 1000, volatility: 0.2, beta: 1, delta: 1 },
    { id: "c", symbol: "CCC", type: "Stock", quantity: 10, price: 100, multiplier: 1, marketValue: 1000, volatility: 0.2, beta: 1, delta: 1 },
  ];
  const result = calculateEfficientFrontier(positions, {
    source: "test",
    fetchedAt: "2026-01-01",
    mappings: { AAA: "AAA", BBB: "BBB", CCC: "CCC" },
    series: [
      seriesFor("AAA", 100, 0, 0.0004),
      seriesFor("BBB", 80, 1.7, 0.0006),
      seriesFor("CCC", 120, 3.1, 0.0003),
    ],
  });
  assert.ok(result);
  assert.equal(result.assetCount, 3);
  assert.equal(result.observations, 90);
  assert.ok(result.cloud.length > 100);
  assert.ok(result.frontier.length > 1);
  assert.equal(result.recommendations.length, 3);
  assert.equal(result.allocationAlternatives.length, 2);
  assert.ok(result.allocationAlternatives.every((alternative) =>
    alternative.turnover <= 0.1300001));
  assert.ok(result.allocationAlternatives.every((alternative) =>
    alternative.changes.length === 3));
  assert.ok(result.allocationAlternatives.every((alternative) =>
    alternative.point.sharpe >= result.current.sharpe));
  assert.notDeepEqual(
    result.allocationAlternatives[0].changes.map((change) => change.proposedWeight),
    result.allocationAlternatives[1].changes.map((change) => change.proposedWeight),
  );
  assert.ok(result.recommendations.every((item) => Number.isFinite(item.change)));
  assert.ok(Number.isFinite(result.current.risk));
  assert.ok(Number.isFinite(result.current.return));
});

test("does not treat the SPY benchmark as an investable frontier asset", () => {
  const dates = Array.from({ length: 61 }, (_, index) =>
    new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10));
  const seriesFor = (symbol, phase) => ({
    symbol,
    sourceSymbol: symbol,
    dates,
    adjustedClose: dates.map((_, index) => 100 * (1 + index * 0.001 + Math.sin(index + phase) * 0.01)),
  });
  const positions = [
    { id: "a", symbol: "AAA", type: "Stock", quantity: 10, price: 100, multiplier: 1, marketValue: 1000, volatility: 0.2, beta: 1, delta: 1 },
    { id: "b", symbol: "BBB", type: "Stock", quantity: 10, price: 100, multiplier: 1, marketValue: 1000, volatility: 0.2, beta: 1, delta: 1 },
  ];
  const result = calculateEfficientFrontier(positions, {
    source: "test",
    fetchedAt: "2026-01-01",
    mappings: { AAA: "AAA", BBB: "BBB", SPY: "SPY" },
    series: [seriesFor("AAA", 0), seriesFor("BBB", 1), seriesFor("SPY", 2)],
  });
  assert.ok(result);
  assert.equal(result.assetCount, 2);
  assert.ok(result.recommendations.every((item) => item.symbol !== "SPY"));
});

test("negative quantities reverse directional risk exposure", () => {
  const base = {
    type: "Stock",
    price: 100,
    multiplier: 1,
    marketValue: 1000,
    volatility: 0.2,
    beta: 1,
    delta: 1,
  };
  const long = { ...base, id: "long", symbol: "LONG", quantity: 10 };
  const hedge = { ...base, id: "short", symbol: "SHORT", quantity: -10 };
  const unhedged = calculateRisk([long], "parametric", 0.99, 1);
  const hedged = calculateRisk([long, hedge], "parametric", 0.99, 1);
  assert.ok(unhedged.dailyVolatility > 0);
  assert.ok(hedged.dailyVolatility < unhedged.dailyVolatility);
});

test("retries fallback risk factors when history later becomes available", () => {
  const dates = Array.from({ length: 61 }, (_, index) =>
    new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10));
  const prices = dates.map((_, index) => 100 * (1 + index * 0.001 + Math.sin(index) * 0.01));
  const position = {
    id: "retry",
    symbol: "AAA",
    type: "Stock",
    quantity: 10,
    price: 100,
    multiplier: 1,
    marketValue: 1000,
    volatility: 0.25,
    beta: 1,
    delta: 1,
    riskSource: "fallback",
  };
  const [enriched] = enrichPositionsWithHistoricalRisk([position], {
    source: "test",
    fetchedAt: "2026-01-01",
    mappings: { AAA: "AAA", SPY: "SPY" },
    series: [
      { symbol: "AAA", sourceSymbol: "AAA", dates, adjustedClose: prices },
      { symbol: "SPY", sourceSymbol: "SPY", dates, adjustedClose: prices.map((price) => price * 5) },
    ],
  });
  assert.equal(enriched.riskSource, "historical");
});

test("fits and interpolates a Hull-White initial discount curve", () => {
  const calibration = fitHullWhiteCurve([
    { maturity: 1, yield: 0.04 },
    { maturity: 2, yield: 0.041 },
    { maturity: 5, yield: 0.043 },
    { maturity: 10, yield: 0.045 },
  ], "2026-07-17T00:00:00Z", "2026-07-19T12:00:00Z");
  assert.equal(calibration.model, "Hull-White 1F");
  assert.equal(calibration.meanReversion, 0.03);
  assert.equal(calibration.volatility, 0.01);
  assert.equal(calibration.fitRmse, 0);
  assert.equal(
    hullWhiteDiscountFactor(calibration, 2),
    1 / (1 + 0.041 / 2) ** 4,
  );
  const interpolated = hullWhiteDiscountFactor(calibration, 3);
  assert.ok(interpolated > calibration.curve[2].discountFactor);
  assert.ok(interpolated < calibration.curve[1].discountFactor);
  assert.equal(isHullWhiteStale(calibration, new Date("2026-07-20T11:59:59Z")), false);
  assert.equal(isHullWhiteStale(calibration, new Date("2026-07-20T12:00:01Z")), true);
});

test("prices zero-coupon bond options with Hull-White dynamics", () => {
  const calibration = fitHullWhiteCurve([
    { maturity: 0.25, yield: 0.04 },
    { maturity: 1, yield: 0.041 },
    { maturity: 5, yield: 0.043 },
    { maturity: 10, yield: 0.045 },
  ], "2026-07-17T00:00:00Z");
  const call = hullWhiteBondOption(calibration, 0.25, 10, 0.65, "C");
  const put = hullWhiteBondOption(calibration, 0.25, 10, 0.65, "P");
  assert.ok(call && put);
  assert.ok(call.price >= 0);
  assert.ok(put.price >= 0);
  assert.ok(call.delta > 0 && call.delta < 1);
  assert.ok(put.delta < 0 && put.delta > -1);
  const optionDiscount = hullWhiteDiscountFactor(calibration, 0.25);
  const bondDiscount = hullWhiteDiscountFactor(calibration, 10);
  assert.ok(Math.abs(
    (call.price - put.price) - (bondDiscount - 0.65 * optionDiscount),
  ) < 1e-10);
});
