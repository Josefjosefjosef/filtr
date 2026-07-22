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
