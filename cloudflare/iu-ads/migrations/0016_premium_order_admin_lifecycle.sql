-- Premium selected-services — admin lifecycle (payment, pause meta, history, renewals, notes, portal code)
PRAGMA foreign_keys = ON;

ALTER TABLE orders ADD COLUMN customer_order_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_customer_order_code
  ON orders(customer_order_code)
  WHERE customer_order_code IS NOT NULL;

ALTER TABLE premium_selected_orders ADD COLUMN payment_status TEXT DEFAULT 'unpaid';
ALTER TABLE premium_selected_orders ADD COLUMN paid_at TEXT;
ALTER TABLE premium_selected_orders ADD COLUMN paid_by TEXT;
ALTER TABLE premium_selected_orders ADD COLUMN payment_received_at TEXT;
ALTER TABLE premium_selected_orders ADD COLUMN rejection_reason TEXT;
ALTER TABLE premium_selected_orders ADD COLUMN admin_pause_reason TEXT;
ALTER TABLE premium_selected_orders ADD COLUMN admin_paused_at TEXT;
ALTER TABLE premium_selected_orders ADD COLUMN admin_paused_by TEXT;
ALTER TABLE premium_selected_orders ADD COLUMN admin_resumed_at TEXT;
ALTER TABLE premium_selected_orders ADD COLUMN admin_resumed_by TEXT;

CREATE TABLE IF NOT EXISTS premium_order_events (
  event_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  actor_user_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES premium_selected_orders(order_id)
);

CREATE INDEX IF NOT EXISTS idx_premium_order_events_order ON premium_order_events(order_id, created_at);

CREATE TABLE IF NOT EXISTS premium_order_renewals (
  renewal_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  contracted_position INTEGER NOT NULL,
  old_end_at TEXT NOT NULL,
  new_end_at TEXT NOT NULL,
  duration_months INTEGER NOT NULL DEFAULT 6,
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CZK',
  price_snapshot_json TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  idempotency_key TEXT UNIQUE,
  FOREIGN KEY (order_id) REFERENCES premium_selected_orders(order_id)
);

CREATE TABLE IF NOT EXISTS premium_order_notes (
  note_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  body_text TEXT NOT NULL,
  author_user_id TEXT,
  author_label TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES premium_selected_orders(order_id)
);

CREATE INDEX IF NOT EXISTS idx_premium_order_notes_order ON premium_order_notes(order_id, created_at);

CREATE TABLE IF NOT EXISTS premium_order_portal_codes (
  order_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  code_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES premium_selected_orders(order_id)
);

UPDATE system_settings SET value = '0016', updated_at = datetime('now') WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('SCHEMA_VERSION', '0016', datetime('now'));
