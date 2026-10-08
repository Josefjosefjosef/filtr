-- Archived PDF bytes before corrective replace (accounting audit trail).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS document_content_revisions (
  revision_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  replacement_reason TEXT NOT NULL,
  actor_user_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(document_id)
);

CREATE INDEX IF NOT EXISTS idx_document_content_revisions_doc ON document_content_revisions(document_id, version);

UPDATE system_settings SET value = '0020', updated_at = datetime('now') WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('SCHEMA_VERSION', '0020', datetime('now'));
