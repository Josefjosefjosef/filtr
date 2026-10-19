-- Central offer registry v20 (local/staging). Adds claim index for offer recompute after claim moves.



CREATE INDEX IF NOT EXISTS idx_central_claims_offer_id ON central_offer_source_claims(offer_id);


