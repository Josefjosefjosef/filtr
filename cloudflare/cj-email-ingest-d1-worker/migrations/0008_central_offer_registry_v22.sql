-- Central offer registry v22 (local/staging). Supporting index only; invariants use d1_batch_invariant_abort (0004).

CREATE INDEX IF NOT EXISTS idx_central_claims_source_pair ON central_offer_source_claims(source, source_record_id);
