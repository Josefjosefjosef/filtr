-- At most one in-review premium order per placement (race-safe reservation).

CREATE UNIQUE INDEX IF NOT EXISTS idx_premium_selected_orders_pending_placement
  ON premium_selected_orders(placement_id)
  WHERE workflow_status IN ('submitted', 'under_review');

UPDATE system_settings SET value = '0024', updated_at = datetime('now') WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('SCHEMA_VERSION', '0024', datetime('now'));
