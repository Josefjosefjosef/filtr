/** Idempotent D1 schema (staging / local SQL tests). */
import { migrateCentralOfferRegistryD1 } from "./iu-cj-affiliate-phase2-central-offer-d1-v19.mjs";

export const D1_MIGRATION_VERSION = 13;

export const INGEST_SQL = Object.freeze({
  migrateLeases: `CREATE TABLE IF NOT EXISTS ingest_leases (
    lease_id TEXT PRIMARY KEY,
    holder_run_id TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  migrateCheckpoint: `CREATE TABLE IF NOT EXISTS sync_checkpoint (
    mailbox TEXT NOT NULL,
    folder TEXT NOT NULL DEFAULT 'INBOX',
    uidvalidity INTEGER,
    completed_uids_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (mailbox, folder)
  )`,
  migrateLifecycle: `CREATE TABLE IF NOT EXISTS message_lifecycle (
    msg_key TEXT PRIMARY KEY,
    mailbox TEXT NOT NULL,
    uidvalidity INTEGER NOT NULL,
    uid INTEGER NOT NULL,
    stage TEXT NOT NULL,
    content_hash TEXT,
    raw_snapshot_json TEXT,
    results_summary_json TEXT,
    fail_reason TEXT,
    publishable INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    updated_at TEXT,
    completed_at TEXT
  )`,
  migrateJobs: `CREATE TABLE IF NOT EXISTS ingest_runs (
    run_id TEXT PRIMARY KEY,
    mode TEXT,
    started_at TEXT,
    finished_at TEXT,
    ok INTEGER,
    batch_size INTEGER,
    error_summary TEXT,
    updated_at TEXT
  )`,
  idxLifecycleStage: `CREATE INDEX IF NOT EXISTS idx_message_lifecycle_stage ON message_lifecycle (stage)`,
  migrateCompletedUids: `CREATE TABLE IF NOT EXISTS completed_uids (
    mailbox TEXT NOT NULL,
    folder TEXT NOT NULL DEFAULT 'INBOX',
    uidvalidity INTEGER NOT NULL,
    uid INTEGER NOT NULL,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (mailbox, folder, uidvalidity, uid)
  )`,
  migrateBatchInvariantAbort: `CREATE TABLE IF NOT EXISTS d1_batch_invariant_abort (
    must_be_one INTEGER NOT NULL CHECK (must_be_one = 1)
  )`,
});

export async function migrateD1Schema(db) {
  const statements = [
    INGEST_SQL.migrateLeases,
    INGEST_SQL.migrateCheckpoint,
    INGEST_SQL.migrateLifecycle,
    INGEST_SQL.migrateJobs,
    INGEST_SQL.idxLifecycleStage,
    INGEST_SQL.migrateCompletedUids,
    INGEST_SQL.migrateBatchInvariantAbort,
  ];
  for (const sql of statements) {
    await db.prepare(sql).run();
  }
  try {
    await db.prepare("ALTER TABLE sync_checkpoint ADD COLUMN uidvalidity_transition_id TEXT").run();
  } catch {
    /* column exists */
  }
  await migrateCentralOfferRegistryD1(db);
  return { ok: true, version: D1_MIGRATION_VERSION };
}
