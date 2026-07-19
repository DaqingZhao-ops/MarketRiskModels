import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const configuredUrl = process.env.PYTHON_RISK_API_URL?.trim();
  if (!configuredUrl) {
    return NextResponse.json(
      {
        error:
          "Python risk service is not configured. The interface will use its TypeScript continuity engine.",
      },
      { status: 503 },
    );
  }

  const serviceUrl = `${configuredUrl.replace(/\/$/, "")}/api/v1/risk/calculate`;
  try {
    const response = await fetch(serviceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
      cache: "no-store",
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      {
        error:
          "Python risk service is unavailable. The interface will use its TypeScript continuity engine.",
      },
      { status: 502 },
    );
  }
}

