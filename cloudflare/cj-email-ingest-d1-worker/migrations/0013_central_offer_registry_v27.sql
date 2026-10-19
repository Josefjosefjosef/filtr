-- Central offer registry v27 — typed revision ranks (no lexicographic string compare).

ALTER TABLE central_offer_source_claims ADD COLUMN confirmed_rev_schema TEXT;
ALTER TABLE central_offer_source_claims ADD COLUMN confirmed_rev_num INTEGER;
ALTER TABLE central_offer_source_claims ADD COLUMN confirmed_rev_ms INTEGER;
ALTER TABLE central_offer_source_claims ADD COLUMN claim_accept INTEGER;
