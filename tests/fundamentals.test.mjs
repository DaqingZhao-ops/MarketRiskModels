import assert from "node:assert/strict";
import test from "node:test";

import { currentMarketCap } from "../lib/fundamentals.ts";

test("uses current price and latest shares instead of a stale reported market cap", () => {
  assert.equal(
    currentMarketCap(539.05, 2_538_377_716, 1_486_526_071_054),
    539.05 * 2_538_377_716,
  );
});

test("falls back to reported market cap when current inputs are unavailable", () => {
  assert.equal(currentMarketCap(undefined, 2_538_377_716, 1_486_526_071_054), 1_486_526_071_054);
});
