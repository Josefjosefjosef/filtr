-- InfoUzel Ads D1 migration 0001 — business/admin layer (SEPARATE from iu-analytics).
-- No anonymous aggregate tables (daily_*), no IP/UA/fingerprint storage.
-- Passwords and client access codes: HASH ONLY.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_roles (
  role_code TEXT PRIMARY KEY,
  title_cs TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  force_password_change INTEGER NOT NULL DEFAULT 0 CHECK (force_password_change IN (0,1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deactivated_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_user_roles (
  user_id TEXT NOT NULL,
  role_code TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  assigned_by TEXT,
  PRIMARY KEY (user_id, role_code),
  FOREIGN KEY (user_id) REFERENCES admin_users(user_id),
  FOREIGN KEY (role_code) REFERENCES admin_roles(role_code)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT,
  FOREIGN KEY (user_id) REFERENCES admin_users(user_id)
);

CREATE TABLE IF NOT EXISTS admin_password_resets (
  reset_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES admin_users(user_id)
);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  attempt_id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0,1)),
  reason_code TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  client_id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  ico TEXT,
  dic TEXT,
  address TEXT,
  billing_info TEXT,
  notes_internal TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  first_cooperation_at TEXT,
  last_cooperation_at TEXT
);

CREATE TABLE IF NOT EXISTS client_contacts (
  contact_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role_label TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

CREATE TABLE IF NOT EXISTS inquiries (
  inquiry_id TEXT PRIMARY KEY,
  client_id TEXT,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  inquiry_id TEXT,
  order_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  ordered_by TEXT,
  payer TEXT,
  contact_person TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(client_id),
  FOREIGN KEY (inquiry_id) REFERENCES inquiries(inquiry_id)
);

CREATE TABLE IF NOT EXISTS contracts (
  contract_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  order_id TEXT,
  contract_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  legal_verified INTEGER NOT NULL DEFAULT 0 CHECK (legal_verified IN (0,1)),
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(client_id),
  FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

CREATE TABLE IF NOT EXISTS invoices (
  invoice_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  order_id TEXT,
  campaign_id TEXT,
  invoice_number TEXT NOT NULL UNIQUE,
  variable_symbol TEXT,
  status TEXT NOT NULL,
  issued_at TEXT,
  due_at TEXT,
  paid_at TEXT,
  tax_base_cents INTEGER,
  vat_cents INTEGER,
  total_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'CZK',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id TEXT PRIMARY KEY,
  evidence_code TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  order_id TEXT,
  contract_id TEXT,
  invoice_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  label_type TEXT NOT NULL DEFAULT 'Reklama',
  start_at TEXT,
  end_at TEXT,
  actual_start_at TEXT,
  actual_end_at TEXT,
  target_url TEXT,
  price_cents INTEGER,
  price_ex_vat_cents INTEGER,
  vat_cents INTEGER,
  pricing_model TEXT,
  impression_limit INTEGER,
  click_limit INTEGER,
  budget_limit_cents INTEGER,
  devices_json TEXT,
  sections_json TEXT,
  regions_json TEXT,
  note_internal TEXT,
  note_client TEXT,
  note_public TEXT,
  client_report_enabled INTEGER NOT NULL DEFAULT 1 CHECK (client_report_enabled IN (0,1)),
  client_export_enabled INTEGER NOT NULL DEFAULT 0 CHECK (client_export_enabled IN (0,1)),
  ordered_by TEXT,
  payer TEXT,
  agency_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

CREATE TABLE IF NOT EXISTS campaign_status_events (
  event_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_user_id TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)
);

CREATE TABLE IF NOT EXISTS placement_types (
  placement_type_id TEXT PRIMARY KEY,
  name_cs TEXT NOT NULL,
  technical_type TEXT NOT NULL,
  section_id TEXT,
  insert_rule TEXT NOT NULL,
  anchor TEXT NOT NULL,
  devices_json TEXT NOT NULL,
  formats_json TEXT,
  min_width INTEGER,
  max_width INTEGER,
  min_height INTEGER,
  max_height INTEGER,
  security_constraints_json TEXT,
  collision_mode TEXT NOT NULL DEFAULT 'exclusive',
  responsive_rules_json TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_placements (
  campaign_placement_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  placement_type_id TEXT NOT NULL,
  section_id TEXT,
  region_code TEXT,
  device_category TEXT NOT NULL CHECK (device_category IN ('pc','mobile','tablet')),
  priority INTEGER NOT NULL DEFAULT 100,
  start_at TEXT,
  end_at TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id),
  FOREIGN KEY (placement_type_id) REFERENCES placement_types(placement_type_id)
);

CREATE TABLE IF NOT EXISTS placement_reservations (
  reservation_id TEXT PRIMARY KEY,
  placement_type_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  device_category TEXT NOT NULL CHECK (device_category IN ('pc','mobile','tablet')),
  section_id TEXT,
  region_code TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  created_at TEXT NOT NULL,
  FOREIGN KEY (placement_type_id) REFERENCES placement_types(placement_type_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)
);

CREATE TABLE IF NOT EXISTS creatives (
  creative_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  campaign_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  device_category TEXT CHECK (device_category IN ('pc','mobile','tablet','universal')),
  format TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  byte_size INTEGER,
  content_hash TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending',
  uploaded_by TEXT,
  approved_at TEXT,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(client_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)
);

CREATE TABLE IF NOT EXISTS rights_confirmations (
  confirmation_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  confirmed_by_name TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  statement_text TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  document_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)
);

CREATE TABLE IF NOT EXISTS documents (
  document_id TEXT PRIMARY KEY,
  client_id TEXT,
  campaign_id TEXT,
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'internal_only' CHECK (visibility IN ('internal_only','client_visible','public')),
  client_can_download INTEGER NOT NULL DEFAULT 0 CHECK (client_can_download IN (0,1)),
  retention_until TEXT,
  uploaded_by TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_access_codes (
  code_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  code_prefix TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  expires_at TEXT,
  deactivated_at TEXT,
  last_used_at TEXT,
  created_by TEXT,
  replaced_by_code_id TEXT,
  data_scope_json TEXT,
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

CREATE TABLE IF NOT EXISTS client_code_campaigns (
  code_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  PRIMARY KEY (code_id, campaign_id),
  FOREIGN KEY (code_id) REFERENCES client_access_codes(code_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)
);

CREATE TABLE IF NOT EXISTS client_sessions (
  session_id TEXT PRIMARY KEY,
  code_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (code_id) REFERENCES client_access_codes(code_id)
);

CREATE TABLE IF NOT EXISTS alerts (
  alert_id TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','resolved')),
  object_type TEXT,
  object_id TEXT,
  assignee_user_id TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS complaints (
  complaint_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  campaign_id TEXT,
  status TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  description TEXT NOT NULL,
  impact TEXT,
  remedy TEXT,
  compensation TEXT,
  assignee_user_id TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  actor_user_id TEXT,
  operation TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  result TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS export_jobs (
  export_id TEXT PRIMARY KEY,
  requested_by TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT,
  period_from TEXT,
  period_to TEXT,
  status TEXT NOT NULL,
  r2_key TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS client_report_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  code_id TEXT,
  payload_json TEXT NOT NULL,
  is_final INTEGER NOT NULL DEFAULT 0 CHECK (is_final IN (0,1)),
  created_at TEXT NOT NULL,
  created_by TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)
);

CREATE TABLE IF NOT EXISTS backup_manifests (
  backup_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  encryption TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_campaigns_client ON campaigns(client_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_period ON campaigns(start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_camp_place_campaign ON campaign_placements(campaign_id);
CREATE INDEX IF NOT EXISTS idx_reservations_window ON placement_reservations(placement_id, device_category, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_creatives_campaign ON creatives(campaign_id);
CREATE INDEX IF NOT EXISTS idx_documents_client ON documents(client_id);
CREATE INDEX IF NOT EXISTS idx_documents_campaign ON documents(campaign_id);
CREATE INDEX IF NOT EXISTS idx_audit_object ON audit_logs(object_type, object_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON admin_login_attempts(email_normalized, attempted_at);
CREATE INDEX IF NOT EXISTS idx_client_codes_client ON client_access_codes(client_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id, status);

INSERT OR IGNORE INTO admin_roles (role_code, title_cs, description, created_at) VALUES
  ('main_admin', 'Hlavní administrátor', 'Úplný přístup', '1970-01-01T00:00:00Z'),
  ('ads_manager', 'Správce reklam', 'Kampaně, kreativy, umístění', '1970-01-01T00:00:00Z'),
  ('sales', 'Obchodník', 'Klienti, poptávky, objednávky, smlouvy', '1970-01-01T00:00:00Z'),
  ('read_only', 'Pouze čtení', 'Read-only přístup', '1970-01-01T00:00:00Z');

INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('ADS_SAFE_MODE', 'true', '1970-01-01T00:00:00Z'),
  ('ADS_PUBLIC_DELIVERY_ENABLED', 'false', '1970-01-01T00:00:00Z'),
  ('ADS_ADMIN_API_ENABLED', 'false', '1970-01-01T00:00:00Z'),
  ('ADS_CLIENT_API_ENABLED', 'false', '1970-01-01T00:00:00Z'),
  ('PERSONALIZED_ADS', 'NO', '1970-01-01T00:00:00Z'),
  ('RETARGETING', 'NO', '1970-01-01T00:00:00Z'),
  ('PROFILING', 'NO', '1970-01-01T00:00:00Z'),
  ('AD_TRACKING_COOKIES', 'NO', '1970-01-01T00:00:00Z'),
  ('CONTEXTUAL_ADS_ONLY', 'YES', '1970-01-01T00:00:00Z'),
  ('SCHEMA_VERSION', '0001', '1970-01-01T00:00:00Z');

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

-- Etapa 3 — Business + documents: indexes + system_settings tunables only.
-- Tables already created above (clients, client_contacts, inquiries, orders,
-- contracts, invoices, documents, rights_confirmations, complaints, export_jobs).

CREATE INDEX IF NOT EXISTS idx_clients_company ON clients(company_name);
CREATE INDEX IF NOT EXISTS idx_client_contacts_client ON client_contacts(client_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_client ON inquiries(client_id, status);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_inquiry ON orders(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_contracts_client ON contracts(client_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_order ON contracts(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status, issued_at);
CREATE INDEX IF NOT EXISTS idx_documents_visibility ON documents(visibility, status);
CREATE INDEX IF NOT EXISTS idx_rights_campaign ON rights_confirmations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_complaints_client ON complaints(client_id, status);
CREATE INDEX IF NOT EXISTS idx_complaints_campaign ON complaints(campaign_id);
CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_export_jobs_requested_by ON export_jobs(requested_by, created_at);

INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('DOCUMENT_SIGNED_URL_MAX_TTL_SECONDS', '3600', '1970-01-01T00:00:00Z'),
  ('EXPORT_JOB_DEFAULT_STATUS', 'queued', '1970-01-01T00:00:00Z');

UPDATE system_settings SET value = '0004', updated_at = '1970-01-01T00:00:00Z' WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('SCHEMA_VERSION', '0004', '1970-01-01T00:00:00Z');

-- Etapa 4 — Campaigns/placements/creatives: indexes + placement_types seed + settings only.
-- Tables already created above (campaigns, campaign_status_events, placement_types,
-- campaign_placements, placement_reservations, creatives, rights_confirmations).

CREATE INDEX IF NOT EXISTS idx_campaign_status_events_campaign ON campaign_status_events(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_placement_types_active ON placement_types(is_active);
CREATE INDEX IF NOT EXISTS idx_campaign_placements_placement ON campaign_placements(placement_id, device_category);
CREATE INDEX IF NOT EXISTS idx_campaign_placements_status ON campaign_placements(status);
CREATE INDEX IF NOT EXISTS idx_reservations_campaign ON placement_reservations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON placement_reservations(status);
CREATE INDEX IF NOT EXISTS idx_creatives_review_status ON creatives(review_status);
CREATE INDEX IF NOT EXISTS idx_creatives_client ON creatives(client_id);

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

-- Etapa 5 — Public delivery engine: indexes + settings only. No new tables — delivery reads
-- campaigns/campaign_placements/placement_types/creatives, all already created above.
-- ADS_PUBLIC_DELIVERY_ENABLED / ADS_SAFE_MODE wrangler defaults are unchanged by this migration;
-- the engine implemented in delivery-engine.ts only ever runs when both gates already allow it.

CREATE INDEX IF NOT EXISTS idx_campaign_placements_delivery ON campaign_placements(status, device_category, section_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_delivery_status ON campaigns(status, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_creatives_delivery ON creatives(campaign_id, review_status, device_category);

INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('PUBLIC_DELIVERY_CACHE_TTL_SECONDS', '300', '1970-01-01T00:00:00Z'),
  ('ADS_LABEL_DEFAULT', 'Reklama', '1970-01-01T00:00:00Z'),
  ('EMERGENCY_PAUSE_ALL', 'false', '1970-01-01T00:00:00Z');

UPDATE system_settings SET value = '0006', updated_at = '1970-01-01T00:00:00Z' WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('SCHEMA_VERSION', '0006', '1970-01-01T00:00:00Z');

-- Etapa 6 — Measurement/reporting settings only. No new tables — impression/click aggregates
-- stay exclusively on the Analytics Worker (`daily_ads`), never mirrored into iu-ads.

INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('ANALYTICS_ADMIN_REPORT_URL', '', '1970-01-01T00:00:00Z'),
  ('STATS_TEST_CAMPAIGN_PREFIX', 'test', '1970-01-01T00:00:00Z');

UPDATE system_settings SET value = '0007', updated_at = '1970-01-01T00:00:00Z' WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('SCHEMA_VERSION', '0007', '1970-01-01T00:00:00Z');
