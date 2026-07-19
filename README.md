# Market Risk Models

A transparent portfolio-risk workbench for stocks, ETFs, mutual funds, bonds,
and options on stocks, ETFs, and bonds.

## Current models

- Historical simulation with deterministic heavy-tail scenarios
- Correlated Monte Carlo simulation
- Parametric variance-covariance VaR
- Expected Shortfall for every model
- Position-level risk contributions
- One-day and ten-day horizons at 95%, 97.5%, and 99% confidence

The first release intentionally uses deterministic synthetic market histories,
so results are reproducible and the application works without credentials. It
is an educational and engineering foundation—not a validated production risk
limit system.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Portfolio CSV

Import a CSV with these exact columns:

```csv
symbol,type,marketValue,volatility,beta,delta
AAPL,Stock,240000,0.29,1.18,1
UST10Y,Bond,225000,0.075,-0.12,1
AAPL C200,Stock Option,46000,0.46,1.25,0.62
```

Volatility is annualized and expressed as a decimal. Options use
delta-adjusted market value. A future release should add gamma, vega, curve
factors, live market histories, backtesting, and stress scenarios.

## Validation

```bash
npm test
npm run lint
```

## Important

This software is not investment advice. Independently validate all data,
assumptions, pricing functions, and model outputs before financial use.
