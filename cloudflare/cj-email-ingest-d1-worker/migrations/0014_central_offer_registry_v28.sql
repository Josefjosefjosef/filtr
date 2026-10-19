-- Central offer registry v28 — confirmed state CAS + delivery history (local only).



ALTER TABLE central_offer_source_claims ADD COLUMN confirmed_gen INTEGER NOT NULL DEFAULT 0;

ALTER TABLE central_offer_source_claims ADD COLUMN confirmed_content_fp TEXT;

ALTER TABLE central_offer_source_claims ADD COLUMN legacy_rev_unverified INTEGER NOT NULL DEFAULT 0;

ALTER TABLE central_offer_source_claims ADD COLUMN last_delivery_observed_at TEXT;



CREATE TABLE IF NOT EXISTS central_offer_claim_deliveries (

  delivery_id TEXT PRIMARY KEY,

  claim_id TEXT NOT NULL,

  source TEXT NOT NULL,

  source_record_id TEXT NOT NULL,

  observed_at TEXT NOT NULL,

  delivery_outcome TEXT NOT NULL,

  reject_reason TEXT,

  delivered_rev_key TEXT,

  delivered_content_fp TEXT NOT NULL,

  delivery_json TEXT NOT NULL,

  event_id TEXT,

  idempotency_key TEXT NOT NULL,

  created_at TEXT NOT NULL,

  UNIQUE(idempotency_key)

);



CREATE INDEX IF NOT EXISTS idx_claim_deliveries_claim_id ON central_offer_claim_deliveries(claim_id);



UPDATE central_offer_source_claims

SET legacy_rev_unverified = 1

WHERE confirmed_rev_schema IS NULL;


