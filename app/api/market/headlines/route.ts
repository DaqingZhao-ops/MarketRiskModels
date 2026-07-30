import { NextRequest, NextResponse } from "next/server";

import {
  fetchSearchHeadlines,
  MARKET_NEWS_QUERIES,
} from "../../../../lib/market-briefing";

export async function GET(request: NextRequest) {
  const parsedBatch = Number(request.nextUrl.searchParams.get("batch") ?? "0");
  const batch = Number.isInteger(parsedBatch) && parsedBatch >= 0 ? parsedBatch : 0;
  try {
    const headlines = await fetchSearchHeadlines(batch);
    return NextResponse.json({
      headlines,
      nextBatch: (batch + 1) % MARKET_NEWS_QUERIES.length,
    });
  } catch {
    return NextResponse.json(
      { detail: "More headlines are temporarily unavailable." },
      { status: 502 },
    );
  }
}
