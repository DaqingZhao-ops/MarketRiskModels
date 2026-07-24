import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const configuredUrl = process.env.PYTHON_RISK_API_URL?.trim();
  if (!configuredUrl) {
    return NextResponse.json(
      { error: "Fixed-portfolio backcasting requires the configured Python service." },
      { status: 503 },
    );
  }
  try {
    const response = await fetch(
      `${configuredUrl.replace(/\/$/, "")}/api/v1/risk/backcast`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await request.text(),
        cache: "no-store",
      },
    );
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "Python fixed-portfolio backcast is unavailable." },
      { status: 502 },
    );
  }
}
