-- Etapa 1 — R2 object access audit + backup foundation markers (no PII plaintext).

CREATE TABLE IF NOT EXISTS object_access_audit (
  access_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  result TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  reason_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_object_access_created ON object_access_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_object_access_key ON object_access_audit(object_key, created_at);

INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('R2_CREATIVES_BUCKET', 'iu-ads-creatives', '1970-01-01T00:00:00Z'),
  ('R2_DOCUMENTS_BUCKET', 'iu-ads-documents', '1970-01-01T00:00:00Z'),
  ('R2_PRIVATE_DOCUMENTS_PUBLIC_URL', 'false', '1970-01-01T00:00:00Z'),
  ('R2_SIGNED_URL_TTL_SECONDS', '300', '1970-01-01T00:00:00Z');

UPDATE system_settings SET value = '0002', updated_at = '1970-01-01T00:00:00Z' WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('SCHEMA_VERSION', '0002', '1970-01-01T00:00:00Z');
