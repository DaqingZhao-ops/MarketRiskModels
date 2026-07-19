import assert from "node:assert/strict";
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
  assert.match(html, /Expected shortfall/);
  assert.match(html, /Positions &amp; sensitivities/);
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
