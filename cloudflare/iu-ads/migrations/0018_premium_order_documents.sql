-- Premium order auto-generated PDF documents (order confirmation + invoice PDF)
PRAGMA foreign_keys = ON;

ALTER TABLE documents ADD COLUMN order_id TEXT;
ALTER TABLE documents ADD COLUMN invoice_id TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_order_id ON documents(order_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_premium_order_kind
  ON documents(order_id, doc_type)
  WHERE order_id IS NOT NULL
    AND doc_type IN ('premium_order_confirmation', 'premium_invoice_pdf');

CREATE TABLE IF NOT EXISTS premium_order_document_jobs (
  job_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  doc_kind TEXT NOT NULL CHECK (doc_kind IN ('order_confirmation', 'invoice_pdf')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'generating', 'ready', 'error')),
  document_id TEXT,
  last_error TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(order_id, doc_kind),
  FOREIGN KEY (order_id) REFERENCES premium_selected_orders(order_id)
);

CREATE INDEX IF NOT EXISTS idx_premium_order_document_jobs_order ON premium_order_document_jobs(order_id);

UPDATE system_settings SET value = '0018', updated_at = datetime('now') WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('SCHEMA_VERSION', '0018', datetime('now'));
