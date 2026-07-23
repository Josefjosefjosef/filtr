-- Etapa 7 — Client access codes + portal (kap. 36–38).
-- Tables `client_access_codes`, `client_code_campaigns`, `client_sessions` already exist in 0001.
-- Adds: login-attempt lockout table (mirrors admin_login_attempts; not present in 0001),
-- indexes, and client-session/lockout tunables. No analytics aggregate tables.

CREATE TABLE IF NOT EXISTS client_login_attempts (
  attempt_id TEXT PRIMARY KEY,
  code_key TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0,1)),
  reason_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_client_codes_hash ON client_access_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_client_codes_status_expires ON client_access_codes(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_client_code_campaigns_campaign ON client_code_campaigns(campaign_id);
CREATE INDEX IF NOT EXISTS idx_client_sessions_code ON client_sessions(code_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_client_login_attempts_key ON client_login_attempts(code_key, attempted_at);

INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('CLIENT_SESSION_TTL_SECONDS', '28800', '1970-01-01T00:00:00Z'),
  ('CLIENT_SESSION_COOKIE_NAME', 'iu_ads_client_session', '1970-01-01T00:00:00Z'),
  ('CLIENT_LOGIN_MAX_ATTEMPTS', '5', '1970-01-01T00:00:00Z'),
  ('CLIENT_LOGIN_LOCKOUT_SECONDS', '900', '1970-01-01T00:00:00Z'),
  ('CLIENT_LOGIN_ATTEMPT_WINDOW_SECONDS', '900', '1970-01-01T00:00:00Z'),
  ('CLIENT_CODE_DEFAULT_TTL_SECONDS', '2592000', '1970-01-01T00:00:00Z');

UPDATE system_settings SET value = '0008', updated_at = '1970-01-01T00:00:00Z' WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('SCHEMA_VERSION', '0008', '1970-01-01T00:00:00Z');
