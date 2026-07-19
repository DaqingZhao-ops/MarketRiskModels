export type HullWhiteCurvePoint = {
  maturity: number;
  yield: number;
  discountFactor: number;
};

export type HullWhiteCalibration = {
  id: string;
  model: "Hull-White 1F";
  version: string;
  curveDate: string;
  calibratedAt: string;
  meanReversion: number;
  volatility: number;
  parameterSource: "governed-default";
  curveSource: string;
  curve: HullWhiteCurvePoint[];
  fitRmse: number;
  status: "valid";
};

export function fitHullWhiteCurve(
  yields: Array<{ maturity: number; yield: number }>,
  curveDate: string,
  calibratedAt = new Date().toISOString(),
): HullWhiteCalibration {
  const curve = yields
    .filter((point) => point.maturity > 0 && point.yield > 0)
    .sort((left, right) => left.maturity - right.maturity)
    .map((point) => ({
      ...point,
      discountFactor: 1 / (1 + point.yield / 2) ** (point.maturity * 2),
    }));
  if (curve.length < 4) throw new Error("The Treasury curve has too few valid maturity points.");
  return {
    id: crypto.randomUUID(),
    model: "Hull-White 1F",
    version: "1.0",
    curveDate,
    calibratedAt,
    meanReversion: 0.03,
    volatility: 0.01,
    parameterSource: "governed-default",
    curveSource: "U.S. Treasury daily par yield curve",
    curve,
    fitRmse: 0,
    status: "valid",
  };
}

export function hullWhiteDiscountFactor(
  calibration: HullWhiteCalibration,
  maturity: number,
) {
  const curve = calibration.curve;
  if (!curve.length || maturity <= 0) return undefined;
  const exact = curve.find((point) => point.maturity === maturity);
  if (exact) return exact.discountFactor;
  const upperIndex = curve.findIndex((point) => point.maturity > maturity);
  if (upperIndex === 0) {
    const point = curve[0];
    return Math.exp(Math.log(point.discountFactor) * maturity / point.maturity);
  }
  if (upperIndex < 0) {
    const point = curve.at(-1);
    if (!point) return undefined;
    return Math.exp(Math.log(point.discountFactor) * maturity / point.maturity);
  }
  const lower = curve[upperIndex - 1];
  const upper = curve[upperIndex];
  const weight = (maturity - lower.maturity) / (upper.maturity - lower.maturity);
  return Math.exp(
    Math.log(lower.discountFactor) * (1 - weight) +
    Math.log(upper.discountFactor) * weight,
  );
}

export function isHullWhiteStale(calibration: HullWhiteCalibration, now = new Date()) {
  return now.getTime() - new Date(calibration.calibratedAt).getTime() > 24 * 60 * 60 * 1000;
}

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
    0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

export function hullWhiteBondOption(
  calibration: HullWhiteCalibration,
  optionExpiry: number,
  bondMaturity: number,
  strike: number,
  callPut: "C" | "P",
) {
  const optionDiscount = hullWhiteDiscountFactor(calibration, optionExpiry);
  const bondDiscount = hullWhiteDiscountFactor(calibration, bondMaturity);
  if (!optionDiscount || !bondDiscount || optionExpiry <= 0 ||
      bondMaturity <= optionExpiry || strike <= 0) return undefined;
  const a = calibration.meanReversion;
  const sigma = calibration.volatility;
  const b = Math.abs(a) < 1e-8
    ? bondMaturity - optionExpiry
    : (1 - Math.exp(-a * (bondMaturity - optionExpiry))) / a;
  const varianceIntegral = Math.abs(a) < 1e-8
    ? optionExpiry
    : (1 - Math.exp(-2 * a * optionExpiry)) / (2 * a);
  const priceVolatility = sigma * b * Math.sqrt(varianceIntegral);
  if (priceVolatility <= 0) return undefined;
  const h = Math.log(bondDiscount / (strike * optionDiscount)) / priceVolatility +
    priceVolatility / 2;
  const callPrice = bondDiscount * normalCdf(h) -
    strike * optionDiscount * normalCdf(h - priceVolatility);
  const price = callPut === "C"
    ? callPrice
    : callPrice - bondDiscount + strike * optionDiscount;
  return {
    price: Math.max(price, 0),
    delta: callPut === "C" ? normalCdf(h) : normalCdf(h) - 1,
    priceVolatility,
  };
}
