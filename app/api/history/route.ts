import { NextRequest, NextResponse } from "next/server";

const PROXIES: Record<string, string> = {
  UST10Y: "TLT",
};

function sourceSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (PROXIES[normalized]) return PROXIES[normalized];
  if (normalized.includes(" ")) return normalized.split(" ")[0];
  return normalized;
}

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
        quote?: Array<{ close?: Array<number | null> }>;
      };
    }>;
    error?: { description?: string } | null;
  };
};

async function fetchSeries(symbol: string, period1: number, period2: number) {
  const mapped = sourceSymbol(symbol);
  const url = new URL(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(mapped)}`,
  );
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(period2));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "div,splits");
  url.searchParams.set("includeAdjustedClose", "true");
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 MarketRiskModels/1.0" },
    next: { revalidate: 21600 },
  });
  if (!response.ok) throw new Error(`${mapped}: market-data request failed (${response.status})`);
  const payload = await response.json() as YahooChart;
  const result = payload.chart?.result?.[0];
  if (!result?.timestamp?.length) {
    throw new Error(`${mapped}: ${payload.chart?.error?.description ?? "no price history returned"}`);
  }
  const prices =
    result.indicators?.adjclose?.[0]?.adjclose ??
    result.indicators?.quote?.[0]?.close ??
    [];
  const observations = result.timestamp
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      price: prices[index],
    }))
    .filter((item): item is { date: string; price: number } =>
      typeof item.price === "number" && Number.isFinite(item.price) && item.price > 0,
    );
  return {
    symbol,
    sourceSymbol: mapped,
    dates: observations.map((item) => item.date),
    adjustedClose: observations.map((item) => item.price),
  };
}

export async function GET(request: NextRequest) {
  const requested = (request.nextUrl.searchParams.get("symbols") ?? "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const symbols = [...new Set(requested)].slice(0, 30);
  if (!symbols.length) {
    return NextResponse.json({ error: "At least one symbol is required." }, { status: 400 });
  }
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const period1 = period2 - 4 * 366 * 86400;
  try {
    const series = await Promise.all(
      symbols.map((symbol) => fetchSeries(symbol, period1, period2)),
    );
    return NextResponse.json({
      source: "Yahoo Finance adjusted daily close",
      fetchedAt: new Date().toISOString(),
      mappings: Object.fromEntries(series.map((item) => [item.symbol, item.sourceSymbol])),
      series,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load price history." },
      { status: 502 },
    );
  }
}
