-- Etapa 8 — Admin ops (kap. 5, 6, 16–19): dashboard / search / calendar / alerts.
-- Table `alerts` already exists in 0001. Adds indexes + alert-generation tunables only.
-- Cron-based alert seeding is deferred to Etapa 9 (optional on-demand generate exists in Worker).

CREATE INDEX IF NOT EXISTS idx_alerts_type_status ON alerts(alert_type, status, created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_object ON alerts(object_type, object_id, status);
CREATE INDEX IF NOT EXISTS idx_alerts_assignee ON alerts(assignee_user_id, status);

INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('ALERT_CAMPAIGN_ENDING_DAYS', '7', '1970-01-01T00:00:00Z'),
  ('ALERT_RECENT_AUDIT_HOURS', '24', '1970-01-01T00:00:00Z'),
  ('DASHBOARD_RESERVATIONS_UPCOMING_DAYS', '14', '1970-01-01T00:00:00Z');

UPDATE system_settings SET value = '0009', updated_at = '1970-01-01T00:00:00Z' WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('SCHEMA_VERSION', '0009', '1970-01-01T00:00:00Z');
