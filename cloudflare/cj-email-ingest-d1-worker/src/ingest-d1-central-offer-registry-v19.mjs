/** D1 schema only for central offer registry v19 (worker bundle — logic lives in repo scripts). */
export const CENTRAL_OFFER_SQL = Object.freeze({
  migrateOffers: `CREATE TABLE IF NOT EXISTS central_offers (
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
  )`,
  migrateClaims: `CREATE TABLE IF NOT EXISTS central_offer_source_claims (
    claim_id TEXT PRIMARY KEY,
    offer_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_record_id TEXT NOT NULL,
    claim_json TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    source_updated_at TEXT,
    UNIQUE(source, source_record_id)
  )`,
  migrateConflictLog: `CREATE TABLE IF NOT EXISTS central_offer_conflict_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    offer_id TEXT NOT NULL,
    conflict_type TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  migrateEvents: `CREATE TABLE IF NOT EXISTS central_registry_events (
    event_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    partner_key TEXT,
    detail_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  migrateCheckpoint: `CREATE TABLE IF NOT EXISTS offer_registry_checkpoint (
    batch_name TEXT PRIMARY KEY,
    cursor_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
});

export const CENTRAL_OFFER_SQL_V20 = Object.freeze({
  idxClaimsOfferId: `CREATE INDEX IF NOT EXISTS idx_central_claims_offer_id ON central_offer_source_claims(offer_id)`,
});

export const CENTRAL_OFFER_SQL_V21 = Object.freeze({
  migrateRevision: `ALTER TABLE central_offers ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`,
});

export async function migrateCentralOfferRegistryD1(db) {
  for (const sql of Object.values(CENTRAL_OFFER_SQL)) {
    await db.prepare(sql).run();
  }
  for (const sql of Object.values(CENTRAL_OFFER_SQL_V20)) {
    await db.prepare(sql).run();
  }
  try {
    await db.prepare(CENTRAL_OFFER_SQL_V21.migrateRevision).run();
  } catch {
    /* exists */
  }
  try {
    await db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_central_claims_source_pair ON central_offer_source_claims(source, source_record_id)`
    ).run();
  } catch {
    /* exists */
  }
  return { ok: true, version: 8 };
}
