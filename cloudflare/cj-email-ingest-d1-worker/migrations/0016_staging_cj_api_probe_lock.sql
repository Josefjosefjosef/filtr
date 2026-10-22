-- One-shot staging CJ API probe audit lock (metadata only, not publication).
CREATE TABLE IF NOT EXISTS staging_cj_api_probe_lock (
  lock_key TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  http_status INTEGER,
  record_count INTEGER,
  connection_state TEXT NOT NULL,
  publishable INTEGER NOT NULL DEFAULT 0 CHECK (publishable = 0)
);
