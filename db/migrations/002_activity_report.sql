-- Activity Report feature — run once against an existing database that already
-- has the base schema (db/schema.sql) applied.
-- Apply with: npx wrangler d1 execute 5thmr-command-hub-db --file=db/migrations/002_activity_report.sql [--local]

ALTER TABLE officers ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE officers ADD COLUMN display_name TEXT;
ALTER TABLE officers ADD COLUMN current_position_id TEXT;

-- One weekly activity rating per officer. '0'..'5' or 'LOA'. Only the current week is ever writable.
CREATE TABLE IF NOT EXISTS activity_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL REFERENCES officers(id),
  week_start TEXT NOT NULL,
  rating TEXT NOT NULL,
  rated_by INTEGER NOT NULL REFERENCES officers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(officer_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_ratings_officer ON activity_ratings(officer_id);
CREATE INDEX IF NOT EXISTS idx_officers_current_position ON officers(current_position_id);
