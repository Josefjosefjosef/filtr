-- Premium selected services — orders, publish idempotency, renewal, email outbox
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS premium_selected_orders (
  order_id TEXT PRIMARY KEY,
  placement_id TEXT NOT NULL,
  category_slug TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 4),
  workflow_status TEXT NOT NULL DEFAULT 'submitted',
  target_url TEXT,
  creative_id TEXT,
  creative_mode TEXT,
  published_campaign_id TEXT,
  published_at TEXT,
  publish_idempotency_key TEXT,
  order_token_hash TEXT NOT NULL,
  client_contact_email TEXT,
  note_client TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(order_id),
  FOREIGN KEY (placement_id) REFERENCES premium_selected_placements(placement_id)
);

CREATE INDEX IF NOT EXISTS idx_premium_selected_orders_status ON premium_selected_orders(workflow_status);
CREATE INDEX IF NOT EXISTS idx_premium_selected_orders_placement ON premium_selected_orders(placement_id);

CREATE TABLE IF NOT EXISTS premium_publish_events (
  event_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

CREATE TABLE IF NOT EXISTS premium_renewal_offers (
  offer_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  offered_price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CZK',
  window_start_at TEXT NOT NULL,
  window_end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offered',
  accepted_order_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id),
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

CREATE INDEX IF NOT EXISTS idx_premium_renewal_offers_campaign ON premium_renewal_offers(campaign_id, status);

CREATE TABLE IF NOT EXISTS email_outbox (
  outbox_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  provider_response TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

INSERT OR IGNORE INTO placement_types
  (placement_type_id, name_cs, technical_type, section_id, insert_rule, anchor, devices_json, formats_json,
   min_width, max_width, min_height, max_height, security_constraints_json, collision_mode, responsive_rules_json,
   is_active, created_at, updated_at)
VALUES
  ('pt_premium_selected_services', 'Premium — Vybrané služby', 'premium_tile', 'affiliate_selected', 'grid_premium', 'affiliate-grid',
   '["pc","mobile","tablet"]', '["logo","full_bleed_banner"]', 160, 480, 90, 160, '{"no_autoplay_audio":true}', 'exclusive', NULL, 1,
   '1970-01-01T00:00:00Z', '1970-01-01T00:00:00Z');

INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES
  ('PREMIUM_RENEWAL_OFFER_DAYS_BEFORE_END', '30', '1970-01-01T00:00:00Z'),
  ('PREMIUM_RENEWAL_REMINDER_DAYS_BEFORE_END', '14', '1970-01-01T00:00:00Z'),
  ('PREMIUM_RENEWAL_WINDOW_DAYS', '14', '1970-01-01T00:00:00Z'),
  ('PREMIUM_PRODUCT_DISCLOSURE_CS', 'InfoUzel.cz nesleduje zobrazení ani prokliky prémiových reklamních pozic. Návštěvnost přivedenou z reklamy může klient měřit prostřednictvím vlastní cílové URL nebo vlastních analytických nástrojů. Reklamní služba představuje pronájem konkrétní prémiové pozice na dobu 6 měsíců a negarantuje konkrétní počet zobrazení ani prokliků.', '1970-01-01T00:00:00Z'),
  ('PREMIUM_PRICING_DISCLOSURE_CS', 'Cena je sjednána vždy na jedno reklamní období v délce 6 měsíců. Cena pro případné další období se řídí aktuálním ceníkem platným v době prodloužení. Prodloužení není automatické.', '1970-01-01T00:00:00Z');

UPDATE system_settings SET value = '0012', updated_at = '1970-01-01T00:00:00Z' WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('SCHEMA_VERSION', '0012', '1970-01-01T00:00:00Z');
