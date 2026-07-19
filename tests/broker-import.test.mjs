import assert from "node:assert/strict";
import test from "node:test";

import { parsePositionsCsv } from "../lib/risk.ts";

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
