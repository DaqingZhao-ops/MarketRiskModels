import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the market risk workbench", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Market Risk Models<\/title>/i);
  assert.match(html, /See the loss before/);
  assert.match(html, /Historical simulation/);
  assert.match(html, /Live market briefing/);
  assert.match(html, /Yahoo Finance headlines/);
  assert.match(html, /Refresh market data/);
  assert.match(html, /13-week Treasury-bill yield/);
  assert.match(html, /Loading live market indicators/);
  assert.match(html, /30-day market trends/);
  assert.match(html, /Expected shortfall/);
  assert.match(html, /Loss distribution legend/);
  assert.match(html, /Tail observations/);
  assert.match(html, /Efficient frontier/);
  assert.match(html, /Fit quality &amp; data diagnostics/);
  assert.match(html, /Data-quality warnings/);
  assert.match(html, /Interest-rate fit/);
  assert.match(html, /<details class="diagnostics panel" id="diagnostics">/);
  assert.match(html, /Loading enough overlapping history/);
  assert.match(html, /Positions &amp; sensitivities/);
  assert.match(html, /New position symbol/);
  assert.match(html, />Add<\/button>/);
  assert.match(html, /Position source files/);
  assert.match(html, /Append selected file/);
  assert.match(html, /Replace portfolio/);
  assert.match(html, />Use as default<\/button>/);
  assert.match(html, /Market price/);
  assert.match(html, /30D range/);
  assert.doesNotMatch(html, /Sort by Multiplier/);
  assert.match(html, /Unavailable/);
  assert.match(html, /Black–Scholes fallback/);
  assert.match(html, /selected stored interest-rate model’s initial discount curve/);
  assert.match(html, /G2\+\+ two factor/);
  assert.match(html, /Risk source/);
  assert.match(html, /Sort by Symbol/);
  assert.match(html, /Drag to move AAPL/);
  assert.match(html, /Click a column heading to sort/);
  assert.match(html, /Calculating…/);
  assert.match(html, /Important limitation/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("includes all supported instrument classes", async () => {
  const response = await render();
  const html = await response.text();
  for (const instrument of [
    "Stock",
    "ETF",
    "Mutual Fund",
    "Bond",
    "Stock Option",
    "ETF Option",
    "Bond Option",
  ]) {
    assert.match(html, new RegExp(instrument));
  }
});

test("ships the requested default share quantities", async () => {
  const csv = await readFile(
    new URL("../public/sample-portfolio.csv", import.meta.url),
    "utf8",
  );
  for (const row of [
    "AAPL,Stock,100,",
    "AMZN,Stock,200,",
    "GOOG,Stock,150,",
    "META,Stock,30,",
    "MSFT,Stock,150,",
    "BABA,Stock,200,",
    "NVDA,Stock,200,",
    "INTC,Stock,200,",
    "COST,Stock,200,",
    "KLAC,Stock,200,",
    "SPY,ETF,100,",
    "SCHD,ETF,1500,",
    "FAGIX,Mutual Fund,2000,",
  ]) {
    assert.match(csv, new RegExp(`^${row}`, "m"));
  }
  assert.match(csv, /Stock Option/);
  assert.match(csv, /^TLT C100,ETF Option,/m);
  assert.match(csv, /^TLT P80,ETF Option,/m);
  assert.match(csv, /^IEF P90,ETF Option,/m);
  assert.match(csv, /^UST10Y,Bond,/m);
});
