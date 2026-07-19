# Development Data Policy

Status: Adopted  
Scope: Default policy for new development  
Last updated: 2026-07-19

## Decision

Use the following default data stack:

| Environment or workload | Default |
| --- | --- |
| Local development and prototypes | SQLite |
| Python object-relational mapping | SQLAlchemy |
| Schema migrations | Alembic |
| Production and multi-user hosting | PostgreSQL |
| Large local analytical workloads | DuckDB as a companion |

## Rationale

SQLite minimizes setup and makes local development and testing portable.
SQLAlchemy provides a consistent application layer and supports migration to
PostgreSQL. PostgreSQL supplies the concurrency, integrity, security, backup,
and operational controls expected in production. Alembic makes schema changes
explicit and repeatable. DuckDB is useful for analytical scans but is not the
default transactional store.

## Portability requirements

- Keep application models and ordinary queries compatible with both SQLite and
  PostgreSQL.
- Exercise migrations and integrity constraints in automated tests.
- Use UTC timestamps and explicit constraints and indexes.
- Keep secrets and database URLs outside source control.
- Document any intentional database-specific behavior.

## Exception process

This is a default, not an absolute rule. A different choice is appropriate when
it clearly improves the system—for example, an existing organizational
database, a browser-only application, specialized mobile storage, high-volume
time-series ingestion, or a predominantly columnar analytical workload.

Before adopting an exception, document why the default is unsuitable, the
recommended alternative, and the consequences for cost, hosting, operations,
portability, and migration. Ask for approval when the exception materially
changes those concerns.

