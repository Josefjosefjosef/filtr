-- Immutable archived Premium terms versions (R2) + per-order binding at submit time.

CREATE TABLE IF NOT EXISTS premium_terms_archives (
  archive_id TEXT PRIMARY KEY,
  terms_version TEXT NOT NULL UNIQUE,
  effective_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_premium_terms_archives_version ON premium_terms_archives(terms_version);

CREATE TABLE IF NOT EXISTS premium_order_terms_bindings (
  order_id TEXT PRIMARY KEY,
  archive_id TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  bound_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES premium_selected_orders(order_id),
  FOREIGN KEY (archive_id) REFERENCES premium_terms_archives(archive_id)
);

CREATE INDEX IF NOT EXISTS idx_premium_order_terms_bindings_archive ON premium_order_terms_bindings(archive_id);
