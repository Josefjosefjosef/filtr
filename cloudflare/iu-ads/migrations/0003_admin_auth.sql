-- Etapa 2 — Admin auth/users/roles/audit: indexes + system_settings tunables.
-- No new PII columns; sessions/resets already hash-only from 0001.

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_password_resets_user ON admin_password_resets(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_user_roles_role ON admin_user_roles(role_code);
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_user_id, created_at);

INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('ADMIN_SESSION_TTL_SECONDS', '28800', '1970-01-01T00:00:00Z'),
  ('ADMIN_SESSION_COOKIE_NAME', 'iu_ads_admin_session', '1970-01-01T00:00:00Z'),
  ('ADMIN_LOGIN_MAX_ATTEMPTS', '5', '1970-01-01T00:00:00Z'),
  ('ADMIN_LOGIN_LOCKOUT_SECONDS', '900', '1970-01-01T00:00:00Z'),
  ('ADMIN_LOGIN_ATTEMPT_WINDOW_SECONDS', '900', '1970-01-01T00:00:00Z'),
  ('ADMIN_PASSWORD_RESET_TTL_SECONDS', '3600', '1970-01-01T00:00:00Z'),
  ('ADMIN_PASSWORD_MIN_LENGTH', '12', '1970-01-01T00:00:00Z'),
  ('ADMIN_PASSWORD_HASH_ITERATIONS', '100000', '1970-01-01T00:00:00Z');

UPDATE system_settings SET value = '0003', updated_at = '1970-01-01T00:00:00Z' WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('SCHEMA_VERSION', '0003', '1970-01-01T00:00:00Z');
