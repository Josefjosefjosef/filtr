/**
 * Production D1 SQL ingest API — parameterized queries, no in-memory authoritative state.
 */
const AFFILIATE_MAILBOX_ADDRESS = "affiliate@infouzel.cz";
import { migrateD1Schema } from "./ingest-d1-sql-schema.mjs";
import { createCentralOfferRegistryStore } from "../../../scripts/iu-cj-affiliate-phase2-central-offer-d1-v29.mjs";
import {
  evaluateFinalizePreconditions,
  buildMessageKey,
  sanitizeFinalizePatch,
} from "./ingest-d1-finalize-guard.mjs";
import { buildFinalizeBatchStatements } from "./ingest-d1-finalize-sql.mjs";
import {
  buildUidValidityResetStatements,
  executeUidValidityReset,
  newUidValidityTransitionId,
} from "./ingest-d1-uidvalidity-reset-sql.mjs";
import {
  evaluateStageTransition,
  sanitizeStageTransitionPatch,
} from "./ingest-d1-stage-transition-guard.mjs";
import {
  sanitizeIngestMutationPatch,
  mapLeaseReasonToMutation,
} from "./ingest-d1-ingest-mutation-guard.mjs";
import {
  sanitizeBeginMessagePatch,
  sanitizeUidValidityPatch,
  sanitizeRecordIngestJobPatch,
} from "./ingest-d1-mailbox-mutation-guard.mjs";

const GLOBAL_LEASE_ID = "gha-ingest-primary";
const DEFAULT_FOLDER = "INBOX";

function nowIso() {
  return new Date().toISOString();
}

function msgKey(mailbox, uidvalidity, uid) {
  return String(mailbox) + ":" + String(uidvalidity) + ":" + String(uid);
}

function parseCompleted(json) {
  try {
    const arr = JSON.parse(json || "[]");
    return Array.isArray(arr) ? arr.map(Number) : [];
  } catch {
    return [];
  }
}

export async function createD1SqlIngestApi(db, options = {}) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("d1_binding_invalid");
  }
  await migrateD1Schema(db);

  const registryStore = createCentralOfferRegistryStore(db, {
    allowTestHooks: options.allowRegistryTestHooks === true,
  });

  const defaultMailbox = options.mailbox || AFFILIATE_MAILBOX_ADDRESS;

  async function assertActiveLeaseHolder(runId) {
    const acquiredAt = nowIso();
    const held = await db
      .prepare("SELECT holder_run_id FROM ingest_leases WHERE lease_id = ? AND expires_at >= ?")
      .bind(GLOBAL_LEASE_ID, acquiredAt)
      .first();
    if (!held) return { ok: false, reason: "finalize_lease_missing" };
    if (held.holder_run_id !== runId) {
      return { ok: false, reason: "finalize_lease_holder_mismatch", holder: held.holder_run_id };
    }
    return { ok: true };
  }

  async function assertTransitionLeaseHolder(runId) {
    const held = await assertActiveLeaseHolder(runId);
    if (!held.ok) {
      if (held.reason === "finalize_lease_missing") {
        return { ok: false, reason: "transition_lease_missing" };
      }
      if (held.reason === "finalize_lease_holder_mismatch") {
        return { ok: false, reason: "transition_lease_holder_mismatch", holder: held.holder };
      }
    }
    return held;
  }

  async function assertMutationLease(runId, prefix) {
    return mapLeaseReasonToMutation(await assertActiveLeaseHolder(runId), prefix);
  }

  async function completedUidRowExists(mailbox, uidvalidity, uid) {
    const row = await db
      .prepare(
        "SELECT 1 AS ok FROM completed_uids WHERE mailbox = ? AND folder = ? AND uidvalidity = ? AND uid = ? LIMIT 1"
      )
      .bind(mailbox, DEFAULT_FOLDER, Number(uidvalidity), Number(uid))
      .first();
    return Boolean(row);
  }

  async function ensureCheckpointRow(mailbox = defaultMailbox, folder = DEFAULT_FOLDER) {
    const ts = nowIso();
    await db
      .prepare(
        `INSERT INTO sync_checkpoint (mailbox, folder, uidvalidity, completed_uids_json, updated_at)
         VALUES (?, ?, NULL, '[]', ?)
         ON CONFLICT(mailbox, folder) DO NOTHING`
      )
      .bind(mailbox, folder, ts)
      .run();
  }

  return {
    backend: "d1-sql",
    async acquireRunLease(runId, ttlMs = 900_000) {
      ttlMs = ttlMs ?? 900_000;
      const now = Date.now();
      const acquiredAt = new Date(now).toISOString();
      const expiresAt = new Date(now + ttlMs).toISOString();
      await db.prepare("DELETE FROM ingest_leases WHERE expires_at < ?").bind(acquiredAt).run();
      const active = await db
        .prepare("SELECT holder_run_id FROM ingest_leases WHERE lease_id = ? AND expires_at >= ?")
        .bind(GLOBAL_LEASE_ID, acquiredAt)
        .first();
      if (active && active.holder_run_id !== runId) {
        return { ok: false, reason: "concurrent_run_blocked", holder: active.holder_run_id };
      }
      await db
        .prepare(
          `INSERT INTO ingest_leases (lease_id, holder_run_id, acquired_at, expires_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(lease_id) DO UPDATE SET
             holder_run_id = excluded.holder_run_id,
             acquired_at = excluded.acquired_at,
             expires_at = excluded.expires_at
           WHERE ingest_leases.expires_at < excluded.acquired_at
              OR ingest_leases.holder_run_id = excluded.holder_run_id`
        )
        .bind(GLOBAL_LEASE_ID, runId, acquiredAt, expiresAt)
        .run();
      const held = await db
        .prepare("SELECT holder_run_id FROM ingest_leases WHERE lease_id = ? AND expires_at >= ?")
        .bind(GLOBAL_LEASE_ID, acquiredAt)
        .first();
      if (!held || held.holder_run_id !== runId) {
        return { ok: false, reason: "concurrent_run_blocked", holder: held?.holder_run_id || null };
      }
      return { ok: true };
    },

    async releaseRunLease(runId) {
      await db
        .prepare("DELETE FROM ingest_leases WHERE lease_id = ? AND holder_run_id = ?")
        .bind(GLOBAL_LEASE_ID, runId)
        .run();
      return { ok: true };
    },

    async getSyncCheckpoint() {
      await ensureCheckpointRow();
      const row = await db
        .prepare("SELECT uidvalidity, completed_uids_json FROM sync_checkpoint WHERE mailbox = ? AND folder = ?")
        .bind(defaultMailbox, DEFAULT_FOLDER)
        .first();
      const uv = row?.uidvalidity ?? null;
      let completedUids = [];
      if (uv != null) {
        const rows = await db
          .prepare(
            "SELECT uid FROM completed_uids WHERE mailbox = ? AND folder = ? AND uidvalidity = ? ORDER BY uid ASC"
          )
          .bind(defaultMailbox, DEFAULT_FOLDER, uv)
          .all();
        completedUids = (rows?.results || []).map((r) => Number(r.uid));
      } else {
        completedUids = parseCompleted(row?.completed_uids_json);
        const rows = await db
          .prepare("SELECT DISTINCT uid FROM completed_uids WHERE mailbox = ? AND folder = ? ORDER BY uid ASC")
          .bind(defaultMailbox, DEFAULT_FOLDER)
          .all();
        const fromTable = (rows?.results || []).map((r) => Number(r.uid));
        completedUids = [...new Set([...completedUids, ...fromTable])].sort((a, b) => a - b);
      }
      return {
        mailbox: defaultMailbox,
        folder: DEFAULT_FOLDER,
        uidvalidity: uv,
        completedUids,
      };
    },

    async applyUidValidityChange(current, previous, patch = {}) {
      const sanitized = sanitizeUidValidityPatch(patch);
      if (!sanitized.ok) return sanitized;
      const safe = sanitized.patch;
      const lease = await assertMutationLease(safe.runId, "uidvalidity");
      if (!lease.ok) return lease;
      await ensureCheckpointRow();
      const cpRow = await db
        .prepare("SELECT uidvalidity FROM sync_checkpoint WHERE mailbox = ? AND folder = ?")
        .bind(defaultMailbox, DEFAULT_FOLDER)
        .first();
      const storedUv = cpRow?.uidvalidity != null ? Number(cpRow.uidvalidity) : null;
      const prev = previous != null ? Number(previous) : null;
      const cur = current != null ? Number(current) : null;
      if (safe.expectedPreviousUidvalidity != null) {
        const exp = Number(safe.expectedPreviousUidvalidity);
        if (storedUv != null && storedUv !== exp) {
          return { ok: false, reason: "uidvalidity_checkpoint_mismatch", stored: storedUv };
        }
        if (storedUv == null && prev != null && prev !== exp) {
          return { ok: false, reason: "uidvalidity_checkpoint_mismatch", expected: exp, previous: prev };
        }
      }
      const nowLease = nowIso();
      const ts = nowIso();
      if (cur != null && storedUv === cur) {
        return { ok: true, changed: false, reset: false, idempotent: true };
      }
      if (prev != null && cur != null && prev !== cur) {
        if (storedUv != null && storedUv !== prev) {
          return { ok: false, reason: "uidvalidity_stale_previous", stored: storedUv, previous: prev };
        }
        const transitionId = newUidValidityTransitionId(safe.runId, ts);
        const { updateStmt, deleteStmt, verifyStmt } = buildUidValidityResetStatements(db, {
          defaultMailbox,
          defaultFolder: DEFAULT_FOLDER,
          prev,
          cur,
          ts,
          transitionId,
          globalLeaseId: GLOBAL_LEASE_ID,
          runId: safe.runId,
          nowIsoLease: nowLease,
        });
        const resetOut = await executeUidValidityReset(db, updateStmt, deleteStmt, verifyStmt);
        if (!resetOut.ok) {
          return resetOut;
        }
        return {
          ok: true,
          changed: true,
          reset: true,
          atomicEngine: resetOut.engine,
          transitionId,
          updChanges: resetOut.updChanges,
          delChanges: resetOut.delChanges,
        };
      }
      if (cur != null) {
        const run = await db
          .prepare(
            `UPDATE sync_checkpoint SET uidvalidity = ?, updated_at = ?
             WHERE mailbox = ? AND folder = ?
             AND (uidvalidity IS NULL OR uidvalidity = ?)
             AND EXISTS (
               SELECT 1 FROM ingest_leases
               WHERE lease_id = ? AND holder_run_id = ? AND expires_at >= ?
             )`
          )
          .bind(cur, ts, defaultMailbox, DEFAULT_FOLDER, cur, GLOBAL_LEASE_ID, safe.runId, nowLease)
          .run();
        if ((run?.meta?.changes ?? 0) === 0) {
          const after = await db
            .prepare("SELECT uidvalidity FROM sync_checkpoint WHERE mailbox = ? AND folder = ?")
            .bind(defaultMailbox, DEFAULT_FOLDER)
            .first();
          if (after?.uidvalidity != null && Number(after.uidvalidity) === cur) {
            return { ok: true, changed: false, reset: false, idempotent: true };
          }
          return { ok: false, reason: "uidvalidity_conflict" };
        }
      }
      return { ok: true, changed: false, reset: false };
    },

    async isUidCompleted(uid, uidvalidity = null) {
      if (uidvalidity != null) {
        return completedUidRowExists(defaultMailbox, uidvalidity, uid);
      }
      const cp = await this.getSyncCheckpoint();
      if (cp.uidvalidity != null) {
        return completedUidRowExists(defaultMailbox, cp.uidvalidity, uid);
      }
      if (cp.completedUids.map(Number).includes(Number(uid))) return true;
      const row = await db
        .prepare(
          "SELECT 1 AS ok FROM completed_uids WHERE mailbox = ? AND folder = ? AND uid = ? LIMIT 1"
        )
        .bind(defaultMailbox, DEFAULT_FOLDER, Number(uid))
        .first();
      return Boolean(row);
    },

    async getLifecycle(key) {
      const row = await db.prepare("SELECT * FROM message_lifecycle WHERE msg_key = ?").bind(key).first();
      if (!row) return null;
      return {
        key: row.msg_key,
        mailbox: row.mailbox,
        uidvalidity: row.uidvalidity,
        uid: row.uid,
        stage: row.stage,
        contentHash: row.content_hash,
        failReason: row.fail_reason,
        publishable: row.publishable === 1,
      };
    },

    async beginMessage(record, patch = {}) {
      const sanitized = sanitizeBeginMessagePatch(patch);
      if (!sanitized.ok) return sanitized;
      const safe = sanitized.patch;
      const mailbox = record.mailbox || defaultMailbox;
      const uv = Number(record.uidvalidity);
      const uid = Number(record.uid);
      const key = msgKey(mailbox, uv, uid);
      if (safe.expectedUidvalidity != null && Number(safe.expectedUidvalidity) !== uv) {
        return { ok: false, reason: "begin_message_uidvalidity_mismatch" };
      }
      const lease = await assertMutationLease(safe.runId, "begin_message");
      if (!lease.ok) return lease;
      const existingRow = await db
        .prepare("SELECT stage, started_at FROM message_lifecycle WHERE msg_key = ?")
        .bind(key)
        .first();
      const ts = nowIso();
      const nowLease = nowIso();
      if (!existingRow) {
        const run = await db
          .prepare(
            `INSERT INTO message_lifecycle (
              msg_key, mailbox, uidvalidity, uid, stage, content_hash, publishable, started_at, updated_at, fail_reason
            )
            SELECT ?, ?, ?, ?, 'fetched', ?, 0, ?, ?, NULL
            WHERE NOT EXISTS (SELECT 1 FROM message_lifecycle WHERE msg_key = ?)
            AND EXISTS (
              SELECT 1 FROM ingest_leases
              WHERE lease_id = ? AND holder_run_id = ? AND expires_at >= ?
            )`
          )
          .bind(key, mailbox, uv, uid, record.contentHash || null, ts, ts, key, GLOBAL_LEASE_ID, safe.runId, nowLease)
          .run();
        if ((run?.meta?.changes ?? 0) === 0) {
          const raced = await db
            .prepare("SELECT stage FROM message_lifecycle WHERE msg_key = ?")
            .bind(key)
            .first();
          if (raced?.stage === "fetched") {
            return { ok: true, duplicate: false, idempotent: true, retry: false, key, stage: "fetched" };
          }
          return { ok: false, reason: "begin_message_conflict" };
        }
        return { ok: true, duplicate: false, retry: false, key, stage: "fetched" };
      }
      if (existingRow.stage === "completed") {
        return { ok: true, duplicate: true, key, stage: "completed" };
      }
      if (existingRow.stage === "failed") {
        const run = await db
          .prepare(
            `UPDATE message_lifecycle SET stage = 'fetched', fail_reason = NULL, content_hash = ?, updated_at = ?
             WHERE msg_key = ? AND stage = 'failed'
             AND EXISTS (
               SELECT 1 FROM ingest_leases
               WHERE lease_id = ? AND holder_run_id = ? AND expires_at >= ?
             )`
          )
          .bind(record.contentHash || null, ts, key, GLOBAL_LEASE_ID, safe.runId, nowLease)
          .run();
        if ((run?.meta?.changes ?? 0) === 0) {
          return { ok: false, reason: "begin_message_conflict" };
        }
        return { ok: true, duplicate: false, retry: true, key, stage: "fetched" };
      }
      const run = await db
        .prepare(
          `UPDATE message_lifecycle SET content_hash = COALESCE(?, content_hash), updated_at = ?
           WHERE msg_key = ? AND stage = ? AND stage NOT IN ('completed', 'failed')
           AND EXISTS (
             SELECT 1 FROM ingest_leases
             WHERE lease_id = ? AND holder_run_id = ? AND expires_at >= ?
           )`
        )
        .bind(record.contentHash || null, ts, key, existingRow.stage, GLOBAL_LEASE_ID, safe.runId, nowLease)
        .run();
      if ((run?.meta?.changes ?? 0) === 0) {
        const re = await assertMutationLease(safe.runId, "begin_message");
        if (!re.ok) return re;
        return { ok: false, reason: "begin_message_active_locked", stage: existingRow.stage };
      }
      return {
        ok: true,
        duplicate: false,
        idempotent: true,
        retry: false,
        key,
        stage: existingRow.stage,
      };
    },

    async transitionStage(key, nextStage, patch = {}) {
      const sanitized = sanitizeStageTransitionPatch(patch);
      if (!sanitized.ok) return sanitized;
      const safePatch = sanitized.patch;
      const row = await this.getLifecycle(key);
      if (!row) return { ok: false, reason: "lifecycle_missing" };
      const evalOut = evaluateStageTransition(row.stage, nextStage);
      if (!evalOut.ok) return evalOut;
      const lease = await assertTransitionLeaseHolder(safePatch.runId);
      if (!lease.ok) return lease;
      if (evalOut.idempotent) {
        return { ok: true, stage: nextStage, idempotent: true };
      }
      const ts = nowIso();
      const nowLease = nowIso();
      const run = await db
        .prepare(
          `UPDATE message_lifecycle SET stage = ?, updated_at = ?, fail_reason = NULL
           WHERE msg_key = ? AND stage = ? AND stage != 'completed' AND stage != 'failed'
           AND EXISTS (
             SELECT 1 FROM ingest_leases
             WHERE lease_id = ? AND holder_run_id = ? AND expires_at >= ?
           )`
        )
        .bind(nextStage, ts, key, row.stage, GLOBAL_LEASE_ID, safePatch.runId, nowLease)
        .run();
      const changes = run?.meta?.changes ?? 0;
      if (changes === 0) {
        return { ok: false, reason: "stage_transition_conflict" };
      }
      void safePatch;
      return { ok: true, stage: nextStage };
    },

    async markFailed(key, reason, patch = {}) {
      const sanitized = sanitizeIngestMutationPatch(patch, { reasonPrefix: "mark_failed" });
      if (!sanitized.ok) return sanitized;
      const safe = sanitized.patch;
      const row = await this.getLifecycle(key);
      if (!row) return { ok: false, reason: "lifecycle_missing" };
      if (row.stage === "completed") {
        return { ok: false, reason: "mark_failed_completed_blocked" };
      }
      if (row.stage === "failed") {
        if (row.failReason === reason) {
          return { ok: true, stage: "failed", idempotent: true };
        }
        return { ok: false, reason: "mark_failed_already_failed" };
      }
      const lease = await assertMutationLease(safe.runId, "mark_failed");
      if (!lease.ok) return lease;
      const ts = nowIso();
      const nowLease = nowIso();
      const run = await db
        .prepare(
          `UPDATE message_lifecycle SET stage = 'failed', fail_reason = ?, publishable = 0, updated_at = ?
           WHERE msg_key = ? AND stage = ? AND stage != 'completed' AND stage != 'failed'
           AND EXISTS (
             SELECT 1 FROM ingest_leases
             WHERE lease_id = ? AND holder_run_id = ? AND expires_at >= ?
           )`
        )
        .bind(reason, ts, key, row.stage, GLOBAL_LEASE_ID, safe.runId, nowLease)
        .run();
      if ((run?.meta?.changes ?? 0) === 0) {
        return { ok: false, reason: "mark_failed_conflict" };
      }
      return { ok: true, stage: "failed" };
    },

    async finalizeCompleted(key, finalPatch = {}) {
      const sanitized = sanitizeFinalizePatch(finalPatch);
      if (!sanitized.ok) return sanitized;
      const patch = sanitized.patch;
      const row = await db.prepare("SELECT * FROM message_lifecycle WHERE msg_key = ?").bind(key).first();
      const pre = evaluateFinalizePreconditions(row, patch);
      if (!pre.ok) return pre;
      const identityKey = buildMessageKey(row.mailbox, row.uidvalidity, row.uid);
      if (identityKey !== key) {
        return { ok: false, reason: "finalize_identity_mismatch" };
      }
      if (typeof db.batch !== "function") {
        return { ok: false, reason: "finalize_batch_not_supported", cloudflareD1: "NOT_VERIFIED" };
      }
      const ts = nowIso();
      const uv = Number(row.uidvalidity);
      const runId = patch.runId;
      const nowLease = nowIso();
      const stmts = buildFinalizeBatchStatements(db, {
        ts,
        key,
        mailbox: row.mailbox,
        uidvalidity: uv,
        uid: row.uid,
        folder: DEFAULT_FOLDER,
        globalLeaseId: GLOBAL_LEASE_ID,
        runId,
        nowIsoLease: nowLease,
      });
      let batchResults;
      try {
        batchResults = await db.batch(stmts);
      } catch {
        return { ok: false, reason: "finalize_batch_failed" };
      }
      const updChanges = batchResults?.[0]?.meta?.changes ?? 0;
      const insChanges = batchResults?.[1]?.meta?.changes ?? 0;
      const after = await db.prepare("SELECT stage, publishable FROM message_lifecycle WHERE msg_key = ?").bind(key).first();
      const hasUid = await completedUidRowExists(row.mailbox, uv, row.uid);
      if (after?.stage === "completed" && hasUid) {
        if (updChanges === 0 && insChanges === 0) {
          return { ok: true, stage: "completed", idempotent: true, uidvalidity: uv };
        }
        return {
          ok: true,
          stage: "completed",
          uidvalidity: uv,
          repaired: pre.repairOnly === true && insChanges > 0,
          atomicBatch: true,
        };
      }
      if (after?.stage === "v15_done") {
        const lease = await assertActiveLeaseHolder(runId);
        if (!lease.ok) return lease;
        return { ok: false, reason: "finalize_conflict" };
      }
      if (after?.stage === "completed" && !hasUid) {
        const lease = await assertActiveLeaseHolder(runId);
        if (!lease.ok) return lease;
      }
      return { ok: false, reason: "finalize_incomplete_after_batch" };
    },

    async persistRawSnapshot(key, snapshot, patch = {}) {
      const sanitized = sanitizeIngestMutationPatch(patch, { reasonPrefix: "persist_raw" });
      if (!sanitized.ok) return sanitized;
      const safe = sanitized.patch;
      const row = await this.getLifecycle(key);
      if (!row) return { ok: false, reason: "lifecycle_missing" };
      if (row.stage === "completed" || row.stage === "failed") {
        return { ok: false, reason: "persist_raw_stage_blocked" };
      }
      if (row.stage !== "fetched") {
        return { ok: false, reason: "persist_raw_stage_blocked" };
      }
      if (safe.expectedUidvalidity != null && Number(safe.expectedUidvalidity) !== Number(row.uidvalidity)) {
        return { ok: false, reason: "persist_raw_uidvalidity_mismatch" };
      }
      const lease = await assertMutationLease(safe.runId, "persist_raw");
      if (!lease.ok) return lease;
      const ts = nowIso();
      const nowLease = nowIso();
      const json = JSON.stringify(snapshot);
      const run = await db
        .prepare(
          `UPDATE message_lifecycle SET raw_snapshot_json = ?, updated_at = ?
           WHERE msg_key = ? AND stage = 'fetched'
           AND EXISTS (
             SELECT 1 FROM ingest_leases
             WHERE lease_id = ? AND holder_run_id = ? AND expires_at >= ?
           )`
        )
        .bind(json, ts, key, GLOBAL_LEASE_ID, safe.runId, nowLease)
        .run();
      if ((run?.meta?.changes ?? 0) === 0) {
        return { ok: false, reason: "persist_raw_conflict" };
      }
      return { ok: true };
    },

    async persistResults(key, results, patch = {}) {
      if (results?.publishable === true) {
        return { ok: false, reason: "persist_results_publishable_forbidden" };
      }
      const sanitized = sanitizeIngestMutationPatch(patch, { reasonPrefix: "persist_results" });
      if (!sanitized.ok) return sanitized;
      const safe = sanitized.patch;
      const row = await this.getLifecycle(key);
      if (!row) return { ok: false, reason: "lifecycle_missing" };
      if (row.stage === "completed" || row.stage === "failed") {
        return { ok: false, reason: "persist_results_stage_blocked" };
      }
      if (row.stage !== "v15_done") {
        return { ok: false, reason: "persist_results_stage_blocked" };
      }
      if (safe.expectedUidvalidity != null && Number(safe.expectedUidvalidity) !== Number(row.uidvalidity)) {
        return { ok: false, reason: "persist_results_uidvalidity_mismatch" };
      }
      const lease = await assertMutationLease(safe.runId, "persist_results");
      if (!lease.ok) return lease;
      const ts = nowIso();
      const nowLease = nowIso();
      const summary = {
        offersCount: results.offersCount ?? 0,
        aiState: results.aiState ?? null,
        v15Blockers: results.v15Blockers ?? 0,
        stagingState: results.stagingState ?? null,
      };
      const run = await db
        .prepare(
          `UPDATE message_lifecycle SET results_summary_json = ?, publishable = 0, updated_at = ?
           WHERE msg_key = ? AND stage = 'v15_done'
           AND EXISTS (
             SELECT 1 FROM ingest_leases
             WHERE lease_id = ? AND holder_run_id = ? AND expires_at >= ?
           )`
        )
        .bind(JSON.stringify(summary), ts, key, GLOBAL_LEASE_ID, safe.runId, nowLease)
        .run();
      if ((run?.meta?.changes ?? 0) === 0) {
        return { ok: false, reason: "persist_results_conflict" };
      }
      return { ok: true };
    },

    async recordIngestJob(job, patch = {}) {
      const sanitized = sanitizeRecordIngestJobPatch(job, patch);
      if (!sanitized.ok) return sanitized;
      const safe = sanitized.patch;
      const runId = safe.runId;
      if (job?.runId && String(job.runId).trim() !== runId) {
        return { ok: false, reason: "record_ingest_job_run_id_mismatch" };
      }
      const lease = await assertMutationLease(runId, "record_ingest_job");
      if (!lease.ok) return lease;
      const ts = nowIso();
      const nowLease = nowIso();
      const finishedAt = ts;
      const mode = job.mode || null;
      const startedAt = job.at || ts;
      const okVal = job.ok ? 1 : 0;
      const batchSize = job.batchSize ?? 0;
      const err = job.errorSummary || null;
      const upd = await db
        .prepare(
          `UPDATE ingest_runs SET finished_at = ?, ok = ?, batch_size = ?, error_summary = ?, updated_at = ?
           WHERE run_id = ?
           AND EXISTS (
             SELECT 1 FROM ingest_leases
             WHERE lease_id = ? AND holder_run_id = ? AND expires_at >= ?
           )`
        )
        .bind(finishedAt, okVal, batchSize, err, ts, runId, GLOBAL_LEASE_ID, runId, nowLease)
        .run();
      if ((upd?.meta?.changes ?? 0) > 0) {
        return { ok: true, jobId: runId, updated: true };
      }
      const ins = await db
        .prepare(
          `INSERT INTO ingest_runs (run_id, mode, started_at, finished_at, ok, batch_size, error_summary, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM ingest_leases
             WHERE lease_id = ? AND holder_run_id = ? AND expires_at >= ?
           )`
        )
        .bind(runId, mode, startedAt, finishedAt, okVal, batchSize, err, ts, GLOBAL_LEASE_ID, runId, nowLease)
        .run();
      if ((ins?.meta?.changes ?? 0) === 0) {
        return { ok: false, reason: "record_ingest_job_conflict" };
      }
      return { ok: true, jobId: runId, created: true };
    },

    async registryRegisterClaim(input) {
      if (!input || typeof input !== "object") return { ok: false, reason: "registry_invalid_input" };
      return registryStore.registerSourceClaim(input);
    },

    async registryGetOffer(offerId) {
      if (!offerId) return { ok: false, reason: "registry_missing_offer_id" };
      const row = await registryStore.getOffer(String(offerId));
      return row ? { ok: true, offer: row } : { ok: false, reason: "registry_offer_not_found" };
    },

    async registrySqlCounts() {
      const offers = await db.prepare("SELECT COUNT(*) AS c FROM central_offers").bind().first();
      const claims = await db.prepare("SELECT COUNT(*) AS c FROM central_offer_source_claims").bind().first();
      const events = await db.prepare("SELECT COUNT(*) AS c FROM central_registry_events").bind().first();
      let deliveries = 0;
      try {
        const d = await db.prepare("SELECT COUNT(*) AS c FROM central_offer_claim_deliveries").bind().first();
        deliveries = Number(d?.c ?? 0);
      } catch {
        deliveries = 0;
      }
      return {
        ok: true,
        offers: Number(offers?.c ?? 0),
        claims: Number(claims?.c ?? 0),
        events: Number(events?.c ?? 0),
        deliveries,
        runtime: "cloudflare_d1_binding",
      };
    },

  };
}
