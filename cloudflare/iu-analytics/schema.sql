-- Canonical schema lives in migrations/0001_init.sql (applied by wrangler d1 migrations apply).
-- This file is a human-readable mirror for reviews; do not diverge without updating the migration.

CREATE TABLE IF NOT EXISTS daily_traffic (
  day TEXT NOT NULL,
  device_category TEXT NOT NULL CHECK (device_category IN ('mobile','tablet','pc','unknown')),
  visits INTEGER NOT NULL DEFAULT 0,
  page_views INTEGER NOT NULL DEFAULT 0,
  public_section_views INTEGER NOT NULL DEFAULT 0,
  private_tools_opens INTEGER NOT NULL DEFAULT 0,
  pwa_installs INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, device_category)
);

CREATE TABLE IF NOT EXISTS daily_sections (
  day TEXT NOT NULL,
  section_id TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, section_id)
);

CREATE TABLE IF NOT EXISTS daily_performance (
  day TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  value_sum REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, metric_name)
);

CREATE TABLE IF NOT EXISTS daily_errors (
  day TEXT NOT NULL,
  error_code TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, error_code)
);

-- Dynamic advertising aggregates (no fixed banner slots).
CREATE TABLE IF NOT EXISTS daily_ads (
  day TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  section_id TEXT NOT NULL DEFAULT '',
  slot_type TEXT NOT NULL DEFAULT 'unknown',
  device_category TEXT NOT NULL CHECK (device_category IN ('mobile','tablet','pc','unknown')),
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  valid_clicks INTEGER NOT NULL DEFAULT 0,
  suspicious_clicks INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, campaign_id, placement_id, section_id, slot_type, device_category)
);

CREATE TABLE IF NOT EXISTS campaign_meta (
  campaign_id TEXT PRIMARY KEY,
  campaign_name TEXT,
  advertiser_name TEXT,
  placement_label TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT,
  pricing_model TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_audit (
  day TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  suspicious INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day)
);
