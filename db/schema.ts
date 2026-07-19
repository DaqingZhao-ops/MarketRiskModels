export const createPortfolioVersionsTable = `
  CREATE TABLE IF NOT EXISTS portfolio_versions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    archived_at TEXT,
    positions_json TEXT NOT NULL,
    source_name TEXT NOT NULL DEFAULT 'Saved portfolio',
    is_default INTEGER NOT NULL DEFAULT 0
  )
`;

export const createPortfolioVersionsIndex = `
  CREATE INDEX IF NOT EXISTS portfolio_versions_default_archive_idx
  ON portfolio_versions (is_default, archived_at DESC)
`;

export const createRateCalibrationsTable = `
  CREATE TABLE IF NOT EXISTS interest_rate_calibrations (
    id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    version TEXT NOT NULL,
    curve_date TEXT NOT NULL,
    calibrated_at TEXT NOT NULL,
    mean_reversion REAL NOT NULL,
    volatility REAL NOT NULL,
    parameter_source TEXT NOT NULL,
    curve_source TEXT NOT NULL,
    curve_json TEXT NOT NULL,
    fit_rmse REAL NOT NULL,
    status TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0
  )
`;

export const createRateCalibrationsIndex = `
  CREATE INDEX IF NOT EXISTS interest_rate_calibrations_active_date_idx
  ON interest_rate_calibrations (is_active, calibrated_at DESC)
`;
