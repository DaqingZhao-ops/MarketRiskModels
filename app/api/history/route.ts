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

async function fetchTreasuryCurve(forceRefresh = false) {
  const now = new Date();
  const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const url = new URL("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml");
  url.searchParams.set("data", "daily_treasury_yield_curve");
  url.searchParams.set("field_tdr_date_value_month", month);
  const response = await fetch(url, forceRefresh
    ? { cache: "no-store" }
    : { next: { revalidate: 21600 } });
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

type MarketSeries = {
  symbol: string;
  sourceSymbol: string;
  dates: string[];
  adjustedClose: number[];
  latestPrice?: number;
  latestPriceAt?: string;
  currency: string;
  source: string;
  optionQuote?: {
    price: number;
    observedAt: string;
    source: string;
  };
  fundamentals?: {
    marketCap: number;
    freeCashFlow: number;
    priceToFreeCashFlow?: number;
    periodEnd?: string;
    fetchedAt: string;
    source: string;
  };
};

function isOccOption(symbol: string) {
  return /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(symbol.trim().toUpperCase());
}

async function fetchYahooOptionQuote(symbol: string, forceRefresh = false) {
  const contract = symbol.trim().toUpperCase();
  const url = new URL(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(contract)}`,
  );
  url.searchParams.set("range", "5d");
  url.searchParams.set("interval", "1m");
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 MarketRiskModels/1.0" },
    ...(forceRefresh ? { cache: "no-store" as const } : { next: { revalidate: 60 } }),
  });
  if (!response.ok) throw new Error(`${contract}: option quote request failed (${response.status})`);
  const payload = await response.json() as YahooChart;
  const result = payload.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const price = result?.meta?.regularMarketPrice ??
    [...closes].reverse().find((value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (typeof price !== "number") throw new Error(`${contract}: no option market price returned`);
  const timestamp = result?.meta?.regularMarketTime ??
    result?.timestamp?.at(-1);
  return {
    price,
    observedAt: timestamp
      ? new Date(timestamp * 1000).toISOString()
      : new Date().toISOString(),
    source: "Yahoo Finance option trade",
  };
}

async function fetchYahooFundamentals(symbol: string, forceRefresh = false) {
  const ticker = symbol.trim().toUpperCase();
  const now = Math.floor(Date.now() / 1000);
  const url = new URL(
    `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(ticker)}`,
  );
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("type", "trailingMarketCap,trailingFreeCashFlow");
  url.searchParams.set("period1", String(now - 3 * 366 * 86400));
  url.searchParams.set("period2", String(now + 86400));
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 MarketRiskModels/1.0" },
    ...(forceRefresh ? { cache: "no-store" as const } : { next: { revalidate: 21600 } }),
  });
  if (!response.ok) throw new Error(`${ticker}: fundamentals request failed (${response.status})`);
  const payload = await response.json() as {
    timeseries?: {
      result?: Array<{
        trailingMarketCap?: Array<{ asOfDate?: string; reportedValue?: { raw?: number } }>;
        trailingFreeCashFlow?: Array<{ asOfDate?: string; reportedValue?: { raw?: number } }>;
      }>;
    };
  };
  const results = payload.timeseries?.result ?? [];
  const marketCapItem = results.flatMap((item) => item.trailingMarketCap ?? []).at(-1);
  const freeCashFlowItem = results.flatMap((item) => item.trailingFreeCashFlow ?? []).at(-1);
  const marketCap = marketCapItem?.reportedValue?.raw;
  const freeCashFlow = freeCashFlowItem?.reportedValue?.raw;
  if (typeof marketCap !== "number" || typeof freeCashFlow !== "number") {
    throw new Error(`${ticker}: market cap or trailing free cash flow unavailable`);
  }
  return {
    marketCap,
    freeCashFlow,
    priceToFreeCashFlow: freeCashFlow > 0 ? marketCap / freeCashFlow : undefined,
    periodEnd: freeCashFlowItem?.asOfDate,
    fetchedAt: new Date().toISOString(),
    source: "Yahoo Finance trailing fundamentals",
  };
}

async function fetchYahooSeries(
  symbol: string,
  period1: number,
  period2: number,
  forceRefresh = false,
): Promise<MarketSeries> {
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
    ...(forceRefresh ? { cache: "no-store" as const } : { next: { revalidate: 300 } }),
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
    source: "Yahoo Finance fallback",
  };
}

async function fetchPolygonSeries(
  symbol: string,
  period1: number,
  period2: number,
  apiKey: string,
  forceRefresh = false,
): Promise<MarketSeries> {
  const mapped = sourceSymbol(symbol);
  const start = new Date(period1 * 1000).toISOString().slice(0, 10);
  const end = new Date(period2 * 1000).toISOString().slice(0, 10);
  const aggregateUrl = new URL(
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(mapped)}/range/1/day/${start}/${end}`,
  );
  aggregateUrl.searchParams.set("adjusted", "true");
  aggregateUrl.searchParams.set("sort", "asc");
  aggregateUrl.searchParams.set("limit", "50000");
  aggregateUrl.searchParams.set("apiKey", apiKey);
  const requestInit = forceRefresh
    ? { cache: "no-store" as const }
    : { next: { revalidate: 300 } };
  const aggregateResponse = await fetch(aggregateUrl, requestInit);
  if (!aggregateResponse.ok) {
    throw new Error(`${mapped}: Polygon.io request failed (${aggregateResponse.status})`);
  }
  const payload = await aggregateResponse.json() as {
    results?: Array<{ t?: number; c?: number }>;
    error?: string;
  };
  const observations = (payload.results ?? [])
    .filter((item): item is { t: number; c: number } =>
      typeof item.t === "number" && typeof item.c === "number" && item.c > 0)
    .map((item) => ({
      date: new Date(item.t).toISOString().slice(0, 10),
      price: item.c,
    }));
  if (observations.length < 2) {
    throw new Error(`${mapped}: ${payload.error ?? "insufficient Polygon.io history"}`);
  }

  let latestPrice = observations.at(-1)?.price;
  let latestPriceAt = observations.at(-1)?.date;
  const latestUrl = new URL(
    `https://api.polygon.io/v2/last/trade/${encodeURIComponent(mapped)}`,
  );
  latestUrl.searchParams.set("apiKey", apiKey);
  const latestResponse = await fetch(latestUrl, { cache: "no-store" });
  if (latestResponse.ok) {
    const latestPayload = await latestResponse.json() as {
      results?: { p?: number; t?: number };
    };
    if (typeof latestPayload.results?.p === "number") {
      latestPrice = latestPayload.results.p;
      latestPriceAt = typeof latestPayload.results.t === "number"
        ? new Date(latestPayload.results.t / 1_000_000).toISOString()
        : latestPriceAt;
    }
  }
  return {
    symbol,
    sourceSymbol: mapped,
    dates: observations.map((item) => item.date),
    adjustedClose: observations.map((item) => item.price),
    latestPrice,
    latestPriceAt,
    currency: "USD",
    source: "Polygon.io",
  };
}

async function fetchSeries(
  symbol: string,
  period1: number,
  period2: number,
  forceRefresh = false,
  includeFundamentals = false,
) {
  let series: MarketSeries;
  try {
    series = await fetchYahooSeries(symbol, period1, period2, forceRefresh);
  } catch {
    const polygonApiKey = process.env.POLYGON_API_KEY?.trim();
    if (polygonApiKey) {
      series = await fetchPolygonSeries(symbol, period1, period2, polygonApiKey, forceRefresh);
    } else {
      throw new Error(`${sourceSymbol(symbol)}: all configured market-data providers failed`);
    }
  }
  let enrichedSeries = series;
  if (isOccOption(symbol)) {
    try {
      enrichedSeries = {
        ...enrichedSeries,
        optionQuote: await fetchYahooOptionQuote(symbol, forceRefresh),
      };
    } catch {
      // Exact option quotes are best-effort; underlying history remains usable.
    }
  }
  if (includeFundamentals) {
    enrichedSeries = {
      ...enrichedSeries,
      fundamentals: await fetchYahooFundamentals(symbol, forceRefresh),
    };
  }
  return enrichedSeries;
}

export async function GET(request: NextRequest) {
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const requested = (request.nextUrl.searchParams.get("symbols") ?? "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const symbols = [...new Set(requested)].slice(0, 30);
  const fundamentalSymbols = new Set(
    (request.nextUrl.searchParams.get("fundamentals") ?? "")
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean),
  );
  if (!symbols.length) {
    return NextResponse.json({ error: "At least one symbol is required." }, { status: 400 });
  }
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const period1 = period2 - 4 * 366 * 86400;
  try {
    const [results, treasuryResult] = await Promise.all([
      Promise.allSettled(symbols.map((symbol) =>
        fetchSeries(
          symbol,
          period1,
          period2,
          forceRefresh,
          fundamentalSymbols.has(symbol),
        ))),
      symbols.some((symbol) => /^UST(2|5|10|20)Y$/.test(symbol))
        ? fetchTreasuryCurve(forceRefresh).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    const series = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []);
    if (!series.length) throw new Error("No price history was returned for the imported positions.");
    const providers = [...new Set(series.map((item) => item.source))];
    return NextResponse.json({
      source: providers.join(" with "),
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
