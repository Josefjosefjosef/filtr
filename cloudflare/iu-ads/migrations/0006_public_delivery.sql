-- Etapa 5 — Public delivery engine: indexes + settings only. No new tables — delivery reads
-- campaigns/campaign_placements/placement_types/creatives, all already created in 0001.
-- ADS_PUBLIC_DELIVERY_ENABLED / ADS_SAFE_MODE wrangler defaults are unchanged by this migration;
-- the engine implemented in delivery-engine.ts only ever runs when both gates already allow it.

CREATE INDEX IF NOT EXISTS idx_campaign_placements_delivery ON campaign_placements(status, device_category, section_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_delivery_status ON campaigns(status, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_creatives_delivery ON creatives(campaign_id, review_status, device_category);

-- PUBLIC_DELIVERY_CACHE_TTL_SECONDS: TTL (seconds) for the signed `/v1/objects/get` creative path
--   minted per delivered ad — never a permanent public R2 URL (08-r2-plan.md).
-- ADS_LABEL_DEFAULT: fallback disclosure label when a campaign's `label_type` is unexpectedly empty.
-- EMERGENCY_PAUSE_ALL: kill-switch (kap. 14) checked on every delivery request; 'true' forces an
--   empty `{"ads":[]}` response regardless of ADS_SAFE_MODE / ADS_PUBLIC_DELIVERY_ENABLED.
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('PUBLIC_DELIVERY_CACHE_TTL_SECONDS', '300', '1970-01-01T00:00:00Z'),
  ('ADS_LABEL_DEFAULT', 'Reklama', '1970-01-01T00:00:00Z'),
  ('EMERGENCY_PAUSE_ALL', 'false', '1970-01-01T00:00:00Z');

UPDATE system_settings SET value = '0006', updated_at = '1970-01-01T00:00:00Z' WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('SCHEMA_VERSION', '0006', '1970-01-01T00:00:00Z');
