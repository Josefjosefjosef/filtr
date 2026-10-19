-- CJ Affiliate ad archive (published versions + evidence). Separate from premium paid ads.

CREATE TABLE IF NOT EXISTS affiliate_ad_archive_records (
  record_id TEXT PRIMARY KEY,
  partner_name TEXT NOT NULL,
  cj_advertiser_id TEXT,
  cj_identity_json TEXT NOT NULL DEFAULT '{}',
  ad_type TEXT NOT NULL,
  published_text TEXT,
  snapshot_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  gate_decision_json TEXT NOT NULL,
  placement_key TEXT,
  published_at TEXT,
  ended_at TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  legal_hold INTEGER NOT NULL DEFAULT 0,
  retention_class TEXT NOT NULL DEFAULT 'archive_evidence',
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS affiliate_ad_archive_versions (
  version_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES affiliate_ad_archive_records(record_id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  gate_decision_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(record_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_ad_archive_partner ON affiliate_ad_archive_records(partner_name);
CREATE INDEX IF NOT EXISTS idx_affiliate_ad_archive_published ON affiliate_ad_archive_records(published_at);
CREATE INDEX IF NOT EXISTS idx_affiliate_ad_archive_type ON affiliate_ad_archive_records(ad_type);
CREATE INDEX IF NOT EXISTS idx_affiliate_ad_archive_test ON affiliate_ad_archive_records(is_test);
