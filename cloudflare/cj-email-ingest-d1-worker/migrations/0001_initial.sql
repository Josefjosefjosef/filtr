-- Staging D1 schema (apply only after approval)
CREATE TABLE IF NOT EXISTS ingest_leases (
  lease_id TEXT PRIMARY KEY,
  holder_run_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_checkpoint (
  mailbox TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT 'INBOX',
  uidvalidity INTEGER,
  completed_uids_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (mailbox, folder)
);

CREATE TABLE IF NOT EXISTS message_lifecycle (
  msg_key TEXT PRIMARY KEY,
  mailbox TEXT NOT NULL,
  uidvalidity INTEGER NOT NULL,
  uid INTEGER NOT NULL,
  stage TEXT NOT NULL,
  content_hash TEXT,
  raw_snapshot_json TEXT,
  results_summary_json TEXT,
  fail_reason TEXT,
  publishable INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  updated_at TEXT,
  completed_at TEXT
);
