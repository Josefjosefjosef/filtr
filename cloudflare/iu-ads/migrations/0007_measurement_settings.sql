-- Etapa 6 — Measurement/reporting settings only. No new tables in iu-ads: impression/click
-- aggregates stay exclusively on the Analytics Worker (`daily_ads`), matching ANALYTICS_ONLY_TABLES
-- in isolation.ts and kap. 20/33 (iu-ads must never mirror analytics aggregates).
--
-- ANALYTICS_ADMIN_REPORT_URL: base URL of the Analytics Worker (`infouzel-analytics`), e.g.
--   "https://infouzel-analytics.<account>.workers.dev" — never a value containing a token/secret.
--   Empty by default (fail-closed): analytics-client.ts returns 503 stats_not_configured until an
--   operator sets this via a direct D1 update (out-of-band, same pattern as other system_settings).
-- STATS_TEST_CAMPAIGN_PREFIX: prefix used by admin-stats.ts to defense-in-depth exclude test
--   campaigns from every stats response, mirroring Analytics' own `isTestAdCampaignId` ("test").
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('ANALYTICS_ADMIN_REPORT_URL', '', '1970-01-01T00:00:00Z'),
  ('STATS_TEST_CAMPAIGN_PREFIX', 'test', '1970-01-01T00:00:00Z');

UPDATE system_settings SET value = '0007', updated_at = '1970-01-01T00:00:00Z' WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('SCHEMA_VERSION', '0007', '1970-01-01T00:00:00Z');
