-- Durable CJ growth owner-approval nonce reservation (atomic UNIQUE).
-- Production replay protection across GitHub Actions runners.
CREATE TABLE IF NOT EXISTS cj_growth_approval_nonces (
  reservation_key TEXT PRIMARY KEY,
  nonce_hash TEXT NOT NULL,
  repository TEXT NOT NULL,
  main_sha TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  actor TEXT,
  state TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  reserved_at TEXT NOT NULL,
  armed_at TEXT,
  completed_at TEXT,
  failed_at TEXT,
  fail_reason TEXT,
  run_id TEXT,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_cj_growth_nonces_nonce_hash
  ON cj_growth_approval_nonces (nonce_hash);

CREATE INDEX IF NOT EXISTS idx_cj_growth_nonces_expires
  ON cj_growth_approval_nonces (expires_at);
