const backendBase = process.env.NEXT_PUBLIC_RISK_API_URL?.replace(/\/$/, "") ?? "";

const desktopPaths: Record<string, string> = {
  "/api/history": "/api/v1/market/history",
  "/api/market/briefing": "/api/v1/market/briefing",
  "/api/portfolios": "/api/v1/portfolios",
  "/api/rates": "/api/v1/rates",
  "/api/risk": "/api/v1/risk/calculate",
};

export function apiUrl(path: string) {
  if (!backendBase) return path;
  const [pathname, query] = path.split("?", 2);
  const mapped = desktopPaths[pathname] ?? pathname;
  return `${backendBase}${mapped}${query ? `?${query}` : ""}`;
}
