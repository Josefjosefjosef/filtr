-- Central offer registry v26 — confirmed revision key on claims (local/staging).

ALTER TABLE central_offer_source_claims ADD COLUMN confirmed_revision_key TEXT;

CREATE INDEX IF NOT EXISTS idx_central_claims_confirmed_rev ON central_offer_source_claims(source, source_record_id, confirmed_revision_key);
