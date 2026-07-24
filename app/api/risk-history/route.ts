import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const configuredUrl = process.env.PYTHON_RISK_API_URL?.trim();
  if (!configuredUrl) {
    return NextResponse.json(
      { error: "Risk history requires the configured Python service." },
      { status: 503 },
    );
  }
  const query = request.nextUrl.search;
  try {
    const response = await fetch(
      `${configuredUrl.replace(/\/$/, "")}/api/v1/risk/history${query}`,
      { cache: "no-store" },
    );
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "Python risk history is unavailable." },
      { status: 502 },
    );
  }
}
