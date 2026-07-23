-- Etapa 9 — Backup / security closeout (kap. 14 go-live checklist + kap. 34).
-- Table `backup_manifests` already exists in 0001. Adds indexes + retention /
-- emergency-pause tunables only. No analytics tables.

CREATE INDEX IF NOT EXISTS idx_backup_manifests_created ON backup_manifests(created_at);
CREATE INDEX IF NOT EXISTS idx_backup_manifests_status ON backup_manifests(status, created_at);

INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('BACKUP_RETENTION_DAYS', '30', '1970-01-01T00:00:00Z'),
  ('BACKUP_MANIFEST_ONLY_OK', 'true', '1970-01-01T00:00:00Z'),
  ('EMERGENCY_PAUSE_ALL', 'false', '1970-01-01T00:00:00Z'),
  ('ALERT_CRON_ENABLED', 'true', '1970-01-01T00:00:00Z');

UPDATE system_settings SET value = '0010', updated_at = '1970-01-01T00:00:00Z' WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('SCHEMA_VERSION', '0010', '1970-01-01T00:00:00Z');
