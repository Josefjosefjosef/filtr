-- Premium order amendments, extension child orders, billed service period for PDFs
PRAGMA foreign_keys = ON;

ALTER TABLE premium_selected_orders ADD COLUMN parent_order_id TEXT;
ALTER TABLE premium_selected_orders ADD COLUMN billed_service_start_at TEXT;
ALTER TABLE premium_selected_orders ADD COLUMN billed_service_end_at TEXT;

CREATE INDEX IF NOT EXISTS idx_premium_selected_orders_parent ON premium_selected_orders(parent_order_id);

ALTER TABLE premium_order_renewals ADD COLUMN follow_up_order_id TEXT;

UPDATE system_settings SET value = '0022', updated_at = datetime('now') WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('SCHEMA_VERSION', '0022', datetime('now'));
