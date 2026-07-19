export const createPortfolioVersionsTable = `
  CREATE TABLE IF NOT EXISTS portfolio_versions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    archived_at TEXT,
    positions_json TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0
  )
`;

export const createPortfolioVersionsIndex = `
  CREATE INDEX IF NOT EXISTS portfolio_versions_default_archive_idx
  ON portfolio_versions (is_default, archived_at DESC)
`;
