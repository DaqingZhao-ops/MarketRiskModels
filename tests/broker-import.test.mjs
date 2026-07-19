import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateEfficientFrontier,
  enrichPositionsWithHistoricalRisk,
  parsePositionsCsv,
} from "../lib/risk.ts";

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
  assert.ok(result.recommendations.every((item) => Number.isFinite(item.change)));
  assert.ok(Number.isFinite(result.current.risk));
  assert.ok(Number.isFinite(result.current.return));
});
