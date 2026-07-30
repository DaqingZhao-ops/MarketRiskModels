export function currentMarketCap(
  currentPrice: number | undefined,
  sharesOutstanding: number | undefined,
  reportedMarketCap: number,
) {
  if (
    typeof currentPrice === "number" &&
    currentPrice > 0 &&
    typeof sharesOutstanding === "number" &&
    sharesOutstanding > 0
  ) {
    return currentPrice * sharesOutstanding;
  }
  return reportedMarketCap;
}
