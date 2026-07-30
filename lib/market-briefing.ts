export type MarketUnit = "index" | "percent" | "fx" | "gold" | "oil";

export type MarketIndicator = {
  label: string;
  symbol: string;
  value: number;
  previousClose: number;
  change: number;
  percentChange: number;
  unit: MarketUnit;
  marketState: string;
  asOf: string;
  trend: number[];
  future?: MarketIndicator;
};

export type Headline = {
  title: string;
  url: string;
  publishedAt: string;
};

export const MARKET_INDICATORS: ReadonlyArray<readonly [string, string, MarketUnit]> = [
  ["S&P 500", "^GSPC", "index"],
  ["Dow", "^DJI", "index"],
  ["Nasdaq Composite", "^IXIC", "index"],
  ["CBOE Volatility Index", "^VIX", "index"],
  ["Nikkei 225", "^N225", "index"],
  ["FTSE 100", "^FTSE", "index"],
  ["DAX", "^GDAXI", "index"],
  ["Hang Seng", "^HSI", "index"],
  ["Shanghai Composite", "000001.SS", "index"],
  ["10Y Treasury", "^TNX", "percent"],
  ["Money market proxy", "^IRX", "percent"],
  ["EUR / USD", "EURUSD=X", "fx"],
  ["USD / JPY", "JPY=X", "fx"],
  ["USD / CNY", "CNY=X", "fx"],
  ["Gold", "GC=F", "gold"],
  ["WTI crude oil", "CL=F", "oil"],
];

export const INDEX_FUTURES = new Map([
  ["^GSPC", ["S&P 500 Futures", "ES=F"] as const],
  ["^DJI", ["Dow Futures", "YM=F"] as const],
  ["^N225", ["Nikkei 225 Futures", "NKD=F"] as const],
]);

export const MARKET_NEWS_QUERIES = [
  "stock market",
  "global markets",
  "Federal Reserve markets",
  "corporate earnings",
  "technology stocks",
  "Treasury bond market",
  "commodities markets",
  "currency markets",
  "economic outlook",
  "market volatility",
];

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      meta?: {
        regularMarketPrice?: number;
        regularMarketTime?: number;
        marketState?: string;
        previousClose?: number;
        chartPreviousClose?: number;
      };
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
    error?: { description?: string } | null;
  };
};

function validUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export async function fetchMarketIndicator(
  label: string,
  symbol: string,
  unit: MarketUnit,
): Promise<MarketIndicator> {
  const endpoint =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    "?interval=1d&range=1mo";
  const response = await fetch(endpoint, {
    headers: { "User-Agent": "Mozilla/5.0 MarketRiskModels/0.2" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${label}: quote request failed (${response.status})`);
  const payload = await response.json() as YahooChart;
  const result = payload.chart?.result?.[0];
  const meta = result?.meta;
  if (!result || typeof meta?.regularMarketPrice !== "number") {
    throw new Error(`${label}: ${payload.chart?.error?.description ?? "quote unavailable"}`);
  }
  const value = meta.regularMarketPrice;
  const trend = (result.indicators?.quote?.[0]?.close ?? [])
    .filter((close): close is number =>
      typeof close === "number" && Number.isFinite(close));
  const latestIsCurrent = trend.length > 0 &&
    Math.abs(trend.at(-1)! - value) <= Math.max(1e-6, Math.abs(value) * 1e-6);
  const previousClose = latestIsCurrent && trend.length >= 2
    ? trend.at(-2)!
    : trend.at(-1) ?? meta.previousClose ?? meta.chartPreviousClose ?? value;
  const change = value - previousClose;
  const timestamp = meta.regularMarketTime ??
    result.timestamp?.at(-1) ??
    Math.floor(Date.now() / 1000);
  return {
    label,
    symbol,
    value,
    previousClose,
    change,
    percentChange: previousClose ? change / previousClose : 0,
    unit,
    marketState: meta.marketState || "DELAYED",
    asOf: new Date(timestamp * 1000).toISOString(),
    trend: trend.slice(-30),
  };
}

export async function fetchRssHeadlines(): Promise<Headline[]> {
  const response = await fetch("https://finance.yahoo.com/news/rssindex", {
    headers: { "User-Agent": "Mozilla/5.0 MarketRiskModels/0.2" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`headline request failed (${response.status})`);
  const xml = await response.text();
  return (xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []).flatMap((item) => {
    const title = decodeHtml(item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() ?? "");
    const url = decodeHtml(item.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i)?.[1]?.trim() ?? "");
    const publishedAt = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim() ?? "";
    return title && validUrl(url) ? [{ title, url, publishedAt }] : [];
  }).slice(0, 25);
}

export async function fetchSearchHeadlines(batch: number): Promise<Headline[]> {
  const query = MARKET_NEWS_QUERIES[batch % MARKET_NEWS_QUERIES.length];
  const endpoint =
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}` +
    "&quotesCount=0&newsCount=15";
  const response = await fetch(endpoint, {
    headers: { "User-Agent": "Mozilla/5.0 MarketRiskModels/0.2" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`headline request failed (${response.status})`);
  const payload = await response.json() as {
    news?: Array<{
      title?: string;
      link?: string;
      providerPublishTime?: number;
    }>;
  };
  return (payload.news ?? []).flatMap((item) => {
    if (!item.title?.trim() || !validUrl(item.link)) return [];
    return [{
      title: decodeHtml(item.title.trim()),
      url: item.link,
      publishedAt: item.providerPublishTime
        ? new Date(item.providerPublishTime * 1000).toISOString()
        : "",
    }];
  });
}
