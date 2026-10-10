-- Premium: definitive ad turn-off, order storno/cancellation docs, credit notes (accounting)
PRAGMA foreign_keys = OFF;

ALTER TABLE premium_selected_orders ADD COLUMN ad_turned_off_at TEXT;
ALTER TABLE premium_selected_orders ADD COLUMN ad_turned_off_by TEXT;
ALTER TABLE premium_selected_orders ADD COLUMN ad_turn_off_reason TEXT;

ALTER TABLE premium_selected_orders ADD COLUMN accounting_cancelled_at TEXT;
ALTER TABLE premium_selected_orders ADD COLUMN accounting_cancelled_by TEXT;
ALTER TABLE premium_selected_orders ADD COLUMN accounting_cancellation_reason TEXT;

CREATE TABLE IF NOT EXISTS premium_order_storno_records (
  storno_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  storno_number TEXT NOT NULL UNIQUE,
  storno_kind TEXT NOT NULL CHECK (storno_kind IN ('rejection', 'cancellation')),
  reason TEXT,
  invoice_id TEXT,
  credit_note_id TEXT,
  correction_cents INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  created_by TEXT,
  FOREIGN KEY (order_id) REFERENCES premium_selected_orders(order_id)
);

CREATE INDEX IF NOT EXISTS idx_premium_order_storno_records_order ON premium_order_storno_records(order_id);

CREATE TABLE IF NOT EXISTS premium_credit_notes (
  credit_note_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  credit_note_number TEXT NOT NULL UNIQUE,
  correction_cents INTEGER NOT NULL,
  original_total_cents INTEGER NOT NULL,
  new_total_cents INTEGER NOT NULL,
  reason TEXT,
  payment_status_snapshot TEXT,
  amount_paid_cents_snapshot INTEGER,
  issued_at TEXT NOT NULL,
  correction_effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  idempotency_key TEXT UNIQUE,
  FOREIGN KEY (order_id) REFERENCES premium_selected_orders(order_id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_premium_credit_notes_order ON premium_credit_notes(order_id);
CREATE INDEX IF NOT EXISTS idx_premium_credit_notes_invoice ON premium_credit_notes(invoice_id);

CREATE TABLE IF NOT EXISTS premium_order_document_jobs_v2 (
  job_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  doc_kind TEXT NOT NULL CHECK (doc_kind IN ('order_confirmation', 'invoice_pdf', 'order_cancellation', 'credit_note_pdf')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'generating', 'ready', 'error')),
  document_id TEXT,
  last_error TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(order_id, doc_kind),
  FOREIGN KEY (order_id) REFERENCES premium_selected_orders(order_id)
);

INSERT INTO premium_order_document_jobs_v2 (
  job_id, order_id, doc_kind, status, document_id, last_error, idempotency_key, created_at, updated_at
)
SELECT job_id, order_id, doc_kind, status, document_id, last_error, idempotency_key, created_at, updated_at
FROM premium_order_document_jobs;

DROP TABLE premium_order_document_jobs;
ALTER TABLE premium_order_document_jobs_v2 RENAME TO premium_order_document_jobs;

CREATE INDEX IF NOT EXISTS idx_premium_order_document_jobs_order ON premium_order_document_jobs(order_id);

DROP INDEX IF EXISTS idx_documents_premium_order_kind;
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_premium_order_kind
  ON documents(order_id, doc_type)
  WHERE order_id IS NOT NULL
    AND doc_type IN (
      'premium_order_confirmation',
      'premium_invoice_pdf',
      'premium_order_cancellation',
      'premium_credit_note_pdf'
    );

INSERT OR IGNORE INTO system_settings (key, value, updated_at)
VALUES ('PREMIUM_STORNO_SEQ_2026', '0', datetime('now'));
INSERT OR IGNORE INTO system_settings (key, value, updated_at)
VALUES ('PREMIUM_CREDIT_NOTE_SEQ_2026', '0', datetime('now'));

PRAGMA foreign_keys = ON;

UPDATE system_settings SET value = '0021', updated_at = datetime('now') WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('SCHEMA_VERSION', '0021', datetime('now'));
