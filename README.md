# Market Risk Models

A transparent portfolio-risk workbench for stocks, ETFs, mutual funds, bonds,
and options on stocks, ETFs, and bonds.

## Architecture

The project now uses a hybrid architecture:

- **Python + NumPy** is the preferred quantitative engine.
- **FastAPI** exposes risk calculations through a versioned API.
- **SQLite + SQLAlchemy** stores market history and calculation audit records
  during development.
- **Alembic** manages schema migrations.
- **PostgreSQL** is the production database target.
- **TypeScript/React** remains the interactive web interface.
- The original TypeScript calculations remain as a continuity fallback when a
  Python service URL is not configured.

The current `chatgpt.site` deployment runs the web interface and its continuity
engine. It cannot run the Python process itself. Configure
`PYTHON_RISK_API_URL` after deploying the Python service to make Python and the
database the live calculation path.

See [docs/architecture.md](docs/architecture.md) and
[docs/development-data-policy.md](docs/development-data-policy.md).

## Models

- Historical simulation using synchronized adjusted daily closes
- Correlated Monte Carlo using a repaired correlation matrix and Cholesky factor
- Parametric variance-covariance VaR
- Expected Shortfall for every model
- Position-level contributions
- Historical efficient frontier with the current delta-adjusted portfolio marked
- One-day and ten-day horizons at 95%, 97.5%, and 99% confidence

The Python historical engine stores up to four years of Yahoo Finance adjusted
daily closes in the development database. It aligns observations by trading
date and uses actual overlapping ten-trading-day returns. Options are
delta-repriced against parsed underlying symbols, and `UST10Y` maps explicitly
to the `TLT` Treasury-duration proxy.

## Run the Python service

Requirements: Python 3.11 or newer.

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/alembic upgrade head
.venv/bin/uvicorn market_risk.api:app --reload
```

The API runs at `http://localhost:8000`; interactive API documentation is at
`http://localhost:8000/docs`.

The default development database is `backend/data/market_risk.db`. Override it
with `MARKET_RISK_DATABASE_URL`. For PostgreSQL, use a SQLAlchemy PostgreSQL
URL and apply Alembic migrations before starting the service.

## Run the web interface

Requirements: Node.js 22.13 or newer.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`. Set `PYTHON_RISK_API_URL=http://localhost:8000`
to use the Python service. If it is absent or unavailable, the interface
clearly identifies that it is using the TypeScript continuity engine.

## Portfolio CSV

The default portfolio contains the requested AAPL, AMZN, GOOG, META, MSFT,
BABA, NVDA, INTC, COST, KLAC, SPY, SCHD, and FAGIX share quantities, plus
representative equity options, Treasury exposures, and Treasury options.
Prices and option premiums are illustrative inputs and can be edited.
On load, eligible default rows replace their initial risk assumptions with
historical volatility and SPY beta calculations. A row uses fallback values
only when adequate market history is unavailable.
Stocks, ETFs, and mutual funds also refresh from the latest available quote
returned by the market-data feed. Treasury placeholders and sample options
outside the equity-option fallback retain their editable illustrative prices.
Stock and ETF options without a direct quote use a labeled Black-Scholes fallback.
Simplified symbols such as `AAPL C250` assume 90 days to expiration; OCC symbols
use their encoded expiration and strike.
Generic `UST2Y`, `UST5Y`, `UST10Y`, and `UST20Y` rows use a clearly labeled
Treasury curve model when an exact bond quote is unavailable. The fallback
discounts $1 of principal as a zero-coupon exposure at the matching official
U.S. Treasury par yield; it is an approximation, not a clean or dirty bond quote.

Import a Charles Schwab or Fidelity positions CSV directly. The importer recognizes
their common Symbol, Description, Quantity, Price, and Market/Current Value column
names, including currency formatting and quoted descriptions. Cash, totals, and
account-summary rows are ignored. Because broker position exports do not contain
risk sensitivities, the app calculates annualized volatility and SPY beta from
downloaded daily adjusted-close history. Recognizable OCC option symbols also
receive a Black-Scholes delta using historical volatility; otherwise an editable
instrument-class fallback is retained.

The app's native CSV format remains supported:

```csv
symbol,type,quantity,price,multiplier,marketValue,volatility,beta,delta
AAPL,Stock,100,220,1,22000,0.29,1.18,1
UST10Y,Bond,200000,0.96,1,192000,0.075,-0.12,1
AAPL C250,Stock Option,10,8.50,100,8500,0.48,1.18,0.42
```

Volatility is annualized and expressed as a decimal. Options use
delta-adjusted underlying returns and a 100-share contract multiplier.
Historical VaR does not use the volatility or beta columns.

## Validation

```bash
cd backend && .venv/bin/pytest
npm test
npm run lint
```

## Important

This software is not investment advice or a validated production risk-limit
system. Independently validate data licensing, proxies, corporate-action
handling, option approximations, pricing functions, and model outputs before
financial use.
