-- Immutable publish snapshot for order PDF (approver display name at approve-publish time).
PRAGMA foreign_keys = ON;

ALTER TABLE premium_selected_orders ADD COLUMN published_by_display_name TEXT;

UPDATE system_settings SET value = '0019', updated_at = datetime('now') WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('SCHEMA_VERSION', '0019', datetime('now'));
