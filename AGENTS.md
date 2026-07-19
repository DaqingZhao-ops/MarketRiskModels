# Development Defaults

These defaults apply to this repository. Treat them as preferred starting
points, not inflexible requirements.

## Database architecture

- Use SQLite with SQLAlchemy for local development, prototypes, automated
  tests, and single-user applications.
- Use PostgreSQL with SQLAlchemy for production, hosted, multi-user, or
  concurrent applications.
- Use Alembic for schema migrations.
- Keep models, queries, migrations, and tests portable between SQLite and
  PostgreSQL. Avoid database-specific SQL unless it provides a material
  benefit.
- Use DuckDB as an optional analytical companion for large local research or
  columnar workloads. Do not use it as the default transactional application
  database.
- Store timestamps in UTC and use explicit primary keys, foreign keys, unique
  constraints, and indexes.
- Keep credentials and connection strings out of source control.

## Exceptions

Before choosing a different database or data-access approach, explain:

1. Why the default is unsuitable.
2. The proposed alternative.
3. Its operational and migration tradeoffs.

Ask the user to approve the exception when it materially changes architecture,
hosting, cost, portability, or operational complexity. Obvious examples may
include browser-only applications, embedded analytics dominated by columnar
queries, specialized time-series workloads, mobile applications, or systems
that must use an existing managed database.

