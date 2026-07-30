import { NextResponse } from "next/server";

import {
  fetchMarketIndicator,
  fetchRssHeadlines,
  INDEX_FUTURES,
  MARKET_INDICATORS,
  type MarketIndicator,
} from "../../../../lib/market-briefing";

export async function GET() {
  const warnings: string[] = [];
  const cashResults = await Promise.allSettled(
    MARKET_INDICATORS.map(([label, symbol, unit]) =>
      fetchMarketIndicator(label, symbol, unit)),
  );
  const futureEntries = [...INDEX_FUTURES.entries()];
  const futureResults = await Promise.allSettled(
    futureEntries.map(([, [label, symbol]]) =>
      fetchMarketIndicator(label, symbol, "index")),
  );
  const futures = new Map<string, MarketIndicator>();
  futureResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      futures.set(futureEntries[index][0], result.value);
    } else {
      warnings.push(`${futureEntries[index][1][0]} unavailable.`);
    }
  });
  const indicators = cashResults.flatMap((result, index) => {
    if (result.status === "rejected") {
      warnings.push(`${MARKET_INDICATORS[index][0]} unavailable.`);
      return [];
    }
    const future = futures.get(result.value.symbol);
    return [{ ...result.value, ...(future ? { future } : {}) }];
  });

  let headlines = [];
  try {
    headlines = await fetchRssHeadlines();
  } catch {
    warnings.push("Yahoo Finance headlines unavailable.");
  }
  if (!indicators.length && !headlines.length) {
    return NextResponse.json(
      { detail: "Market quotes and headlines are temporarily unavailable." },
      { status: 502 },
    );
  }
  return NextResponse.json({
    source: "Yahoo Finance",
    fetchedAt: new Date().toISOString(),
    indicators,
    headlines,
    warnings,
    disclosures: [
      "Quotes may be delayed and are for situational awareness, not trade execution.",
      "^IRX is the 13-week Treasury-bill yield used as a money-market-rate proxy.",
    ],
  });
}
