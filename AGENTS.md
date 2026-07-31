# MarketRiskModels Development Instructions

These instructions apply to the entire repository. Preserve existing project
conventions and keep the web and macOS applications behaviorally consistent
unless the user explicitly approves a difference.

## Repository architecture

The repository contains a shared market-risk application with several runtime
surfaces:

- `app/`, `worker/`, `db/`, and `drizzle/`: hosted React/TypeScript application
  and Cloudflare-compatible routes.
- `desktop/`: native macOS launcher, packaging, icons, and desktop build scripts.
- `backend/`: Python/FastAPI analytics, persistence, and desktop integration.
- `lib/`: shared TypeScript financial analytics and application contracts.
- `tests/` and `backend/tests/`: TypeScript and Python test suites.

The macOS application is a hybrid application. A macOS task may legitimately
require coordinated changes to Swift, React/TypeScript, Python, or shared
analytics. Do not assume macOS work is Swift-only.

## Cross-platform consistency

- Keep calculations, terminology, timestamps, market-data provenance, and
  user-visible metrics consistent across web and macOS.
- Before changing a shared API, schema, market-data format, financial metric,
  or risk calculation, identify every affected platform and implementation.
- Preserve backward compatibility when practical and update contract tests when
  shared behavior changes.
- Ask the user before changing the meaning, assumptions, or methodology of a
  financial or risk metric.
- Do not allow the TypeScript and Python engines to diverge silently.

## Market data

- Use yfinance/Yahoo Finance as the primary market-data source and Polygon.io
  as the backup unless the user requests a different policy.
- Keep exact option market quotes separate from modeled option values.
- Preserve source and observation timestamps so users can judge data freshness.
- Treat missing fundamentals or unsupported instrument metrics as `N/A`; do not
  fabricate values.

## Database architecture

- Use SQLite with SQLAlchemy for local development, prototypes, automated
  tests, and single-user desktop use.
- Use PostgreSQL with SQLAlchemy for hosted, multi-user, or concurrent
  production services.
- Use Alembic for schema migrations.
- Keep models, queries, migrations, and tests portable between SQLite and
  PostgreSQL unless a database-specific feature provides a material benefit.
- Store timestamps in UTC and use explicit keys, constraints, and indexes.
- Use DuckDB only as an optional analytical companion, not as the default
  transactional database.

Before adopting a different database or data-access architecture, explain why
the default is unsuitable and describe operational and migration tradeoffs.
Ask for approval if the exception materially changes architecture, hosting,
cost, portability, or operational complexity.

## Security and private data

Never commit or expose:

- API keys, tokens, passwords, cookies, OAuth credentials, or private keys.
- Real `.env` values, database credentials, or connection strings.
- Apple signing certificates, provisioning profiles, or App Store credentials.
- Brokerage account numbers, user portfolio files, or personally identifiable
  financial data.
- Local Codex state, conversations, caches, logs, or machine-specific paths.

Keep real secrets in ignored local environment files or managed runtime
variables. Commit only placeholder values in `.env.example` files.

`public/sample-portfolio.csv` is the canonical distributable sample portfolio
and must remain tracked. User-created or imported portfolios are private local
data and must not be staged, committed, or used to overwrite the sample.

Treat `.openai/`, `.codex/`, and similar tool-generated directories as
potentially sensitive. Project configuration may be tracked only when its
contents are intentional, portable, and free of credentials, local paths,
session state, caches, and logs.

## Editing and repository safety

- Inspect `git status` before editing and preserve unrelated user changes.
- Do not force-add ignored files or modify `.gitignore` merely to commit an
  otherwise ignored file.
- Do not commit generated output, caches, virtual environments, local
  databases, DerivedData, Xcode user state, or machine-specific metadata.
- Do not stage, commit, push, publish, deploy, release, rewrite history,
  force-push, or delete branches unless the current request authorizes it.
- Before an authorized push, inspect the changed-file list and summarize the
  relevant diff.

## Testing and completion

Run checks proportionate to the affected surface:

- Web/shared TypeScript: `node --experimental-strip-types --test tests/*.test.mjs`
  and `npm run build`.
- Python backend: run the backend pytest suite from its configured environment.
- macOS packaging: run `npm run desktop:build` when desktop source, packaging,
  or a shared dependency of the packaged app changes.
- Cross-engine analytics: run both TypeScript and Python contract tests.

Do not claim success when a required check could not be run. In the completion
report, list changed files, checks and results, unresolved risks or assumptions,
and whether anything was staged, committed, pushed, published, or deployed.

## Specialized agents

Project-scoped custom agents live in `.codex/agents/` and are optional subagents,
not continuously running owners.

- Use specialized agents only when the user explicitly requests delegation or
  when independent parallel work would materially improve a task and applicable
  instructions authorize it.
- Prefer parallel agents for read-heavy exploration, testing, triage, and review.
- Avoid concurrent edits to shared analytics or contracts.
- The primary agent remains responsible for resolving conflicts, validating the
  integrated result, and reporting one coherent outcome.
