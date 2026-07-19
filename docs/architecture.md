# Market Risk Models Architecture

Status: Implemented foundation  
Version: 0.2  
Last updated: 2026-07-19

## Components

```text
Browser
  |
  v
TypeScript / React interface
  |
  +--> /api/risk proxy --> Python FastAPI service --> SQLAlchemy
  |                                                |--> SQLite (development)
  |                                                `--> PostgreSQL (production)
  |
  `--> TypeScript continuity engine
       (used only when the Python service is not configured or unavailable)
```

## Ownership

The Python service owns:

- Historical, Monte Carlo, and parametric calculations
- Correlation repair and Cholesky simulation
- Market-data acquisition and caching
- Market-price persistence
- Risk-run audit records
- API validation and calculation versioning

The TypeScript application owns:

- Portfolio entry and CSV import
- Model controls
- Interactive tables and charts
- Display formatting
- Routing requests to the Python service
- A clearly identified continuity calculation path

## Database strategy

SQLite is the local-development default. PostgreSQL is the production target.
Both use the same SQLAlchemy models and Alembic migrations. The initial schema
contains:

- `market_prices`: requested symbol, mapped source symbol, trading date,
  adjusted close, source, and retrieval time
- `risk_runs`: model, confidence, horizon, complete request and result
  snapshots, engine version, and creation time

Timestamps are UTC. Constraints and indexes are defined in SQLAlchemy and the
Alembic migration.

## Deployment boundary

The existing Sites deployment supports the TypeScript interface and its
Cloudflare-compatible routes, but not a long-running Python process or SQLite
file. Therefore:

1. The web interface remains deployable and usable with its continuity engine.
2. The Python service must be deployed to a Python-capable host.
3. Production should use PostgreSQL rather than a host-local SQLite file.
4. The web deployment must receive `PYTHON_RISK_API_URL` after the Python
   service is available.

This boundary is intentional and visible in the interface; it is not silently
presented as Python-backed when the Python service is unavailable.

## Next production steps

1. Choose a Python host and managed PostgreSQL provider.
2. Apply Alembic migrations to PostgreSQL.
3. Deploy the FastAPI service and configure health monitoring.
4. Set `PYTHON_RISK_API_URL` in the web deployment.
5. Add authentication between the web proxy and Python API.
6. Add market-data licensing controls, retries, quality checks, and provenance.
7. Reconcile Python and continuity-engine results in automated contract tests.

