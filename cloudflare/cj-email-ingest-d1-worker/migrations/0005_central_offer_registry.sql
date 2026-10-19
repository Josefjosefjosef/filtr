-- Central offer registry v19 (staging/local only). Does not alter 0001-0004 semantics.

CREATE TABLE IF NOT EXISTS central_offers (

  offer_id TEXT PRIMARY KEY,

  identity_key TEXT NOT NULL UNIQUE,

  network TEXT NOT NULL,

  advertiser_id TEXT,

  market TEXT,

  offer_type TEXT,

  conflict_state TEXT NOT NULL,

  publishability_state TEXT NOT NULL,

  block_reason TEXT,

  canonical_json TEXT NOT NULL,

  created_at TEXT NOT NULL,

  updated_at TEXT NOT NULL

);



CREATE TABLE IF NOT EXISTS central_offer_source_claims (

  claim_id TEXT PRIMARY KEY,

  offer_id TEXT NOT NULL,

  source TEXT NOT NULL,

  source_record_id TEXT NOT NULL,

  claim_json TEXT NOT NULL,

  evidence_json TEXT NOT NULL,

  observed_at TEXT NOT NULL,

  source_updated_at TEXT,

  UNIQUE(source, source_record_id)

);



CREATE TABLE IF NOT EXISTS central_offer_conflict_log (

  id INTEGER PRIMARY KEY AUTOINCREMENT,

  offer_id TEXT NOT NULL,

  conflict_type TEXT NOT NULL,

  detail_json TEXT NOT NULL,

  created_at TEXT NOT NULL

);



CREATE TABLE IF NOT EXISTS central_registry_events (

  event_id TEXT PRIMARY KEY,

  kind TEXT NOT NULL,

  partner_key TEXT,

  detail_json TEXT NOT NULL,

  created_at TEXT NOT NULL

);



CREATE TABLE IF NOT EXISTS offer_registry_checkpoint (

  batch_name TEXT PRIMARY KEY,

  cursor_json TEXT NOT NULL,

  updated_at TEXT NOT NULL

);

