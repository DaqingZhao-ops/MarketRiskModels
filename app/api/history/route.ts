import { NextRequest, NextResponse } from "next/server";

const PROXIES: Record<string, string> = {
  UST2Y: "SHY",
  UST5Y: "IEI",
  UST10Y: "IEF",
  UST20Y: "TLT",
};

function sourceSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (PROXIES[normalized]) return PROXIES[normalized];
  const occOption = normalized.replace(/^[+-]/, "").replace(/\s/g, "")
    .match(/^([A-Z]{1,6})\d{6}[CP]\d{8}$/);
  if (occOption) return occOption[1];
  if (/^[A-Z0-9]{9}$/.test(normalized)) return "IEF";
  if (normalized.includes(" ")) return normalized.split(" ")[0];
  return normalized;
}

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      meta?: {
        regularMarketPrice?: number;
        regularMarketTime?: number;
        currency?: string;
      };
      indicators?: {
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
        quote?: Array<{ close?: Array<number | null> }>;
      };
    }>;
    error?: { description?: string } | null;
  };
};

async function fetchTreasuryCurve() {
  const now = new Date();
  const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const url = new URL("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml");
  url.searchParams.set("data", "daily_treasury_yield_curve");
  url.searchParams.set("field_tdr_date_value_month", month);
  const response = await fetch(url, { next: { revalidate: 21600 } });
  if (!response.ok) throw new Error(`Treasury yield curve request failed (${response.status})`);
  const xml = await response.text();
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/gi) ?? [];
  const latest = entries.at(-1);
  if (!latest) throw new Error("Treasury yield curve returned no observations.");
  const value = (field: string) => {
    const match = latest.match(new RegExp(`<d:${field}[^>]*>([^<]+)<\\/d:${field}>`, "i"));
    return match ? Number(match[1]) / 100 : Number.NaN;
  };
  const dateMatch = latest.match(/<d:NEW_DATE[^>]*>([^<]+)<\/d:NEW_DATE>/i);
  const yields = {
    UST2Y: value("BC_2YEAR"),
    UST5Y: value("BC_5YEAR"),
    UST10Y: value("BC_10YEAR"),
    UST20Y: value("BC_20YEAR"),
  };
  if (Object.values(yields).some((yieldValue) => !Number.isFinite(yieldValue))) {
    throw new Error("Treasury yield curve was missing a required maturity.");
  }
  return { asOf: dateMatch?.[1] ?? now.toISOString(), yields };
}

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
    next: { revalidate: 300 },
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
    latestPrice: result.meta?.regularMarketPrice ?? observations.at(-1)?.price,
    latestPriceAt: result.meta?.regularMarketTime
      ? new Date(result.meta.regularMarketTime * 1000).toISOString()
      : observations.at(-1)?.date,
    currency: result.meta?.currency ?? "USD",
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
    const [results, treasuryResult] = await Promise.all([
      Promise.allSettled(symbols.map((symbol) => fetchSeries(symbol, period1, period2))),
      symbols.some((symbol) => /^UST(2|5|10|20)Y$/.test(symbol))
        ? fetchTreasuryCurve().catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    const series = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (!series.length) throw new Error("No price history was returned for the imported positions.");
    return NextResponse.json({
      source: "Yahoo Finance latest quote and adjusted daily close",
      fetchedAt: new Date().toISOString(),
      mappings: Object.fromEntries(series.map((item) => [item.symbol, item.sourceSymbol])),
      series,
      treasuryCurve: treasuryResult,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load price history." },
      { status: 502 },
    );
  }
}
