# Market Risk Monitoring Methodology

Status: Implemented baseline  
Version: 1.0  
Last updated: 2026-07-24

## Purpose

The risk monitor answers two related questions:

1. Is the portfolio's market risk increasing or decreasing?
2. Which positions are causing that change, and which positions are acting as
   hedges?

Every successful Python risk calculation is an immutable observation in
`risk_runs`. The monitor retrieves observations with the same model,
confidence level, horizon, and portfolio identity. Portfolio identity is a
stable hash of account, instrument, quantity, and multiplier—not market value
or estimated risk factors—so ordinary repricing remains in one series while a
trade starts a new series. Mixing configurations would create changes caused
by methodology or holdings rather than markets, so it is intentionally
prohibited.

## Portfolio measures

For observation \(t\), the monitor stores and displays:

- gross market value \(GMV_t = \sum_i |MV_{i,t}|\);
- dollar Value at Risk \(VaR_t\);
- normalized Value at Risk \(VaR_t / GMV_t\);
- Expected Shortfall \(ES_t\);
- daily portfolio volatility; and
- position-level component VaR.

Dollar VaR answers how much capital is exposed. Normalized VaR distinguishes a
larger portfolio from a portfolio that has become riskier per invested dollar.
Expected Shortfall measures average loss beyond the VaR threshold and should
be reviewed with VaR rather than treated as a substitute.

### Nonpositive historical VaR

An empirical historical sample can contain only gains, especially when very
few synchronized observations are available. Its loss quantile is then
negative and a naive nonnegative clamp reports zero VaR despite nonzero
exposure and volatility.

When historical VaR is nonpositive for a portfolio with positive modeled or
observed volatility, the engines apply a delta-normal floor:

\[
VaR_{floor} = z_c \sigma_p \sqrt{h}
\]

Expected Shortfall is floored consistently using the normal-tail conditional
expectation. The result exposes `varFloorApplied` and `varFloor`; the UI raises
a data-quality warning. Legacy persisted observations with positive gross
market value and nonpositive VaR are excluded from the trend endpoint and
reported in its `excludedInvalidPoints` count.

## Signed exposure

The engines represent market value as a nonnegative magnitude. Direction comes
from quantity and delta:

\[
E_i = sign(q_i) \times MV_i \times \Delta_i
\]

This convention handles long and short stocks, calls, and puts consistently.

## Component VaR

Let the daily risk exposure be:

\[
x_i = E_i \frac{\sigma_i}{\sqrt{252}}
\]

and let \(R\) be the repaired position correlation matrix. Portfolio variance
is:

\[
\sigma_p^2 = x^\top R x
\]

The Euler contribution share for position \(i\) is:

\[
s_i = \frac{x_i(Rx)_i}{x^\top R x}
\]

The displayed component VaR is:

\[
CVaR_i = s_i \times VaR
\]

Therefore:

\[
\sum_i CVaR_i = VaR
\]

This allocation is additive for parametric, historical, and Monte Carlo
results. For the latter two models, covariance-based Euler shares allocate the
model's observed portfolio VaR. A negative component VaR is valid: it means
the position reduces portfolio risk under the current covariance assumptions.

Positions with the same symbol in multiple accounts remain separate in the
calculation but are aggregated by symbol in the monitoring API.

## Change measures

For consecutive comparable observations:

\[
\Delta VaR_t = VaR_t - VaR_{t-1}
\]

\[
\Delta CVaR_{i,t} = CVaR_{i,t} - CVaR_{i,t-1}
\]

The UI reports both current dollars and portfolio share. Dollar contribution
can rise while contribution share falls when total risk rises faster.

## Actual portfolio versus fixed portfolio

The monitor offers two distinct series.

### Current portfolio backcast

This is the default 30-trading-day view. Current instruments and quantities
are held fixed. For each historical as-of date:

1. Stock, ETF, and mutual-fund positions are revalued from quantity,
   multiplier, and that date's mapped adjusted close.
2. Other instruments are scaled by the change in their mapped proxy or
   underlying series.
3. Annualized volatility and beta are estimated from the trailing 252
   synchronized observations ending on that date.
4. Historical VaR uses the expanding set of synchronized returns available
   from the beginning of the governed dataset through that date. This matches
   the headline historical model at the latest date while excluding future
   observations.

### Thirty-day portfolio beta

For each backcast date, current position exposures are converted to signed
delta-adjusted weights:

\[
w_i = \frac{sign(q_i) MV_i \Delta_i}{\sum_j |MV_j|}
\]

Using the trailing 252 synchronized observations ending on that date, the
fixed-portfolio return is:

\[
r_{p,t} = \sum_i w_i r_{i,t}
\]

and portfolio beta against SPY is:

\[
\beta_p = \frac{Cov(r_p, r_{SPY})}{Var(r_{SPY})}
\]

The beta plot includes a 1.0 reference line. Values above 1.0 indicate greater
systematic sensitivity than the market; values below 1.0 indicate lower
sensitivity. Negative beta indicates an inverse relationship over the
estimation window. The same fixed-current-delta limitation applies to options.

No return, volatility, or beta observation after the as-of date enters that
day's calculation. The entire series is regenerated when current holdings
change.

Current option delta is held constant across the backcast. Historical option
premium series and point-in-time implied-volatility surfaces are not currently
persisted, so option market values use the mapped underlying-price scaling.
These approximations are labeled in the UI and mean the backcast is
delta-oriented rather than a full historical option repricing.

### Actual portfolio history

The actual-portfolio series is available as the second view for the current,
unchanged holdings. Each point uses the positions and market-risk inputs
submitted at that timestamp. It therefore captures:

- changes in prices, volatility, delta, and dependence assumptions.

A trade or rebalance changes the portfolio identity and starts a new monitoring
series. This prevents startup defaults, archived portfolios, and other holdings
from appearing as false jumps in the current portfolio's market-risk trend.

The backcast reconstructs point-in-time volatility and beta from price history.
Persisting governed daily factor snapshots and option surfaces remains the
preferred future enhancement for exact reproducibility and full nonlinear
option repricing.

## Observation frequency

The application records an observation whenever the Python calculation
endpoint succeeds. The dashboard displays the latest run for each UTC calendar
day, preventing repeated intraday recalculations from distorting the visual
time axis. Intraday observations remain in the audit table and can be retrieved
with `frequency=all`. For operational monitoring, run a consistent calculation
after each market close.

Recommended review windows are:

- one day for immediate changes;
- five trading days for weekly movement;
- approximately 21 trading days for monthly movement; and
- 60 to 250 observations for regime assessment.

## Interpretation and limitations

- VaR is a model quantile, not a maximum possible loss.
- Historical and Monte Carlo component allocations use covariance-based Euler
  shares; nonlinear option risks beyond delta are not separately attributed.
- Contribution estimates depend on volatilities, correlations, and deltas.
- A model or engine-version change should start a new comparison regime.
- Missing positions in a later observation disappear from current
  concentration rankings; their removal remains visible in portfolio VaR.
- Sparse or irregular observations should not be interpreted as a uniformly
  sampled daily series.

The monitor is intended for risk oversight and investigation, not trade
execution or regulatory capital reporting.
