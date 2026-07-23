-- Etapa 4 — Campaigns/placements/creatives: indexes + placement_types seed + settings only.
-- Tables already created in 0001 (campaigns, campaign_status_events, placement_types,
-- campaign_placements, placement_reservations, creatives, rights_confirmations).
-- No destructive DROP; idempotent create + indexes (kap. 10,11,12,13).

CREATE INDEX IF NOT EXISTS idx_campaign_status_events_campaign ON campaign_status_events(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_placement_types_active ON placement_types(is_active);
CREATE INDEX IF NOT EXISTS idx_campaign_placements_placement ON campaign_placements(placement_id, device_category);
CREATE INDEX IF NOT EXISTS idx_campaign_placements_status ON campaign_placements(status);
CREATE INDEX IF NOT EXISTS idx_reservations_campaign ON placement_reservations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON placement_reservations(status);
CREATE INDEX IF NOT EXISTS idx_creatives_review_status ON creatives(review_status);
CREATE INDEX IF NOT EXISTS idx_creatives_client ON creatives(client_id);

-- Placement catalog seed (kap. 10) — inactive-by-default entries are still fail-closed since
-- Public Ad Delivery stays empty until Etapa 5 regardless of this catalog's contents.
INSERT OR IGNORE INTO placement_types
  (placement_type_id, name_cs, technical_type, section_id, insert_rule, anchor, devices_json, formats_json,
   min_width, max_width, min_height, max_height, security_constraints_json, collision_mode, responsive_rules_json,
   is_active, created_at, updated_at)
VALUES
  ('pt_header_leaderboard', 'Horní banner (leaderboard)', 'banner', 'global_header', 'top_of_page', 'header',
   '["pc","tablet"]', '["image"]', 728, 970, 90, 250, '{"no_autoplay_audio":true}', 'exclusive', NULL, 1,
   '1970-01-01T00:00:00Z', '1970-01-01T00:00:00Z'),
  ('pt_sidebar_rectangle', 'Postranní panel (rectangle)', 'banner', 'global_sidebar', 'sidebar_slot', 'sidebar-top',
   '["pc"]', '["image"]', 300, 336, 250, 280, '{"no_autoplay_audio":true}', 'exclusive', NULL, 1,
   '1970-01-01T00:00:00Z', '1970-01-01T00:00:00Z'),
  ('pt_mobile_infeed', 'Mobilní in-feed banner', 'banner', 'article_feed', 'between_items', 'infeed',
   '["mobile","tablet"]', '["image"]', 300, 320, 100, 150, '{"no_autoplay_audio":true}', 'exclusive', NULL, 1,
   '1970-01-01T00:00:00Z', '1970-01-01T00:00:00Z'),
  ('pt_infocentrum_tile', 'Dlaždice v InfoCentru', 'tile', 'infocentrum', 'grid_slot', 'infocentrum-grid',
   '["pc","mobile","tablet"]', '["image"]', 160, 320, 120, 240, '{"no_autoplay_audio":true}', 'shared', NULL, 1,
   '1970-01-01T00:00:00Z', '1970-01-01T00:00:00Z');

INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('RESERVATION_DEFAULT_STATUS', 'reserved', '1970-01-01T00:00:00Z'),
  ('CREATIVE_SIGNED_URL_TTL_SECONDS', '300', '1970-01-01T00:00:00Z'),
  ('CAMPAIGN_RIGHTS_REQUIRED_BEFORE_ACTIVE', 'true', '1970-01-01T00:00:00Z');

UPDATE system_settings SET value = '0005', updated_at = '1970-01-01T00:00:00Z' WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('SCHEMA_VERSION', '0005', '1970-01-01T00:00:00Z');
