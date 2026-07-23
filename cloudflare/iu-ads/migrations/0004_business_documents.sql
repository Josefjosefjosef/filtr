-- Etapa 3 — Business + documents: indexes + system_settings tunables only.
-- Tables already created in 0001 (clients, client_contacts, inquiries, orders,
-- contracts, invoices, documents, rights_confirmations, complaints, export_jobs).
-- No destructive DROP; idempotent create + indexes.

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
