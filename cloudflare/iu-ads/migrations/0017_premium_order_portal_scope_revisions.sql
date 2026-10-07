-- Portal code linkage + public creative revisions + order archive
PRAGMA foreign_keys = ON;

ALTER TABLE premium_order_portal_codes ADD COLUMN code_id TEXT;

CREATE TABLE IF NOT EXISTS premium_order_public_revisions (
  revision_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  creative_id TEXT,
  creative_mode TEXT,
  target_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  replaces_revision_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  approved_at TEXT,
  approved_by TEXT,
  UNIQUE(order_id, version),
  FOREIGN KEY (order_id) REFERENCES premium_selected_orders(order_id)
);

CREATE INDEX IF NOT EXISTS idx_premium_order_revisions_order ON premium_order_public_revisions(order_id, version);

ALTER TABLE orders ADD COLUMN archived_at TEXT;
ALTER TABLE orders ADD COLUMN archive_reason TEXT;

UPDATE system_settings SET value = '0017', updated_at = datetime('now') WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('SCHEMA_VERSION', '0017', datetime('now'));
