-- Staging D1 schema extension (apply only after approval)
CREATE TABLE IF NOT EXISTS ingest_runs (
  run_id TEXT PRIMARY KEY,
  mode TEXT,
  started_at TEXT,
  finished_at TEXT,
  ok INTEGER,
  batch_size INTEGER,
  error_summary TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_message_lifecycle_stage ON message_lifecycle (stage);

CREATE TABLE IF NOT EXISTS completed_uids (
  mailbox TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT 'INBOX',
  uidvalidity INTEGER NOT NULL,
  uid INTEGER NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (mailbox, folder, uidvalidity, uid)
);
