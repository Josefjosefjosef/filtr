/** Atomic UIDVALIDITY reset — transition token + orphan purge verify (v17). */

export const UIDVALIDITY_RESET_SQL = Object.freeze({
  leaseGate: `EXISTS (
      SELECT 1 FROM ingest_leases
      WHERE lease_id = ? AND holder_run_id = ? AND expires_at >= ?
    )`,
});

export function newUidValidityTransitionId(runId, ts) {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `uvt:${runId}:${ts}:${suffix}`;
}

export function buildUidValidityResetStatements(db, params) {
  const {
    defaultMailbox,
    defaultFolder,
    prev,
    cur,
    ts,
    transitionId,
    globalLeaseId,
    runId,
    nowIsoLease,
  } = params;
  const { leaseGate } = UIDVALIDITY_RESET_SQL;
  const updateStmt = db
    .prepare(
      `UPDATE sync_checkpoint SET uidvalidity = ?, completed_uids_json = '[]', updated_at = ?, uidvalidity_transition_id = ?
       WHERE mailbox = ? AND folder = ?
       AND (uidvalidity IS NULL OR uidvalidity = ?)
       AND ${leaseGate}`
    )
    .bind(cur, ts, transitionId, defaultMailbox, defaultFolder, prev, globalLeaseId, runId, nowIsoLease);
  const deleteStmt = db
    .prepare(
      `DELETE FROM completed_uids
       WHERE mailbox = ? AND folder = ? AND uidvalidity = ?
       AND EXISTS (
         SELECT 1 FROM sync_checkpoint sc
         WHERE sc.mailbox = ? AND sc.folder = ? AND sc.uidvalidity = ? AND sc.uidvalidity_transition_id = ?
       )
       AND ${leaseGate}`
    )
    .bind(
      defaultMailbox,
      defaultFolder,
      prev,
      defaultMailbox,
      defaultFolder,
      cur,
      transitionId,
      globalLeaseId,
      runId,
      nowIsoLease
    );
  const verifyStmt = buildUidValidityResetVerifyStatement(db, {
    defaultMailbox,
    defaultFolder,
    prev,
    cur,
    transitionId,
  });
  return { updateStmt, deleteStmt, verifyStmt };
}

/** Abort batch/txn if transition committed but prev completed_uids remain (CHECK insert — works outside triggers). */
export function buildUidValidityResetVerifyStatement(db, params) {
  const { defaultMailbox, defaultFolder, prev, cur, transitionId } = params;
  return db
    .prepare(
      `INSERT INTO d1_batch_invariant_abort (must_be_one)
       SELECT 0
       WHERE (
         EXISTS (
           SELECT 1 FROM sync_checkpoint sc
           WHERE sc.mailbox = ? AND sc.folder = ?
           AND sc.uidvalidity = ? AND sc.uidvalidity_transition_id = ?
         )
         AND EXISTS (
           SELECT 1 FROM completed_uids cu
           WHERE cu.mailbox = ? AND cu.folder = ? AND cu.uidvalidity = ?
         )
       )`
    )
    .bind(defaultMailbox, defaultFolder, cur, transitionId, defaultMailbox, defaultFolder, prev);
}

const ABORT = "UIDVALIDITY_RESET_UPDATE_NOOP";
const INCOMPLETE = "uidvalidity_reset_delete_incomplete";

function mapResetError(e) {
  const msg = String(e?.message || e || "");
  if (e?.code === ABORT) {
    return { ok: false, reason: "uidvalidity_conflict", rolledBack: true, updChanges: 0, delChanges: 0 };
  }
  if (msg.includes(INCOMPLETE) || msg.includes("uidvalidity_reset_delete_incomplete")) {
    return { ok: false, reason: "uidvalidity_reset_incomplete", rolledBack: true };
  }
  if (/CHECK constraint failed/i.test(msg) && /d1_batch_invariant_abort/i.test(msg)) {
    return { ok: false, reason: "uidvalidity_reset_incomplete", rolledBack: true };
  }
  if (/RAISE\(ABORT/i.test(msg)) {
    return { ok: false, reason: "uidvalidity_reset_incomplete", rolledBack: true };
  }
  return { ok: false, reason: "uidvalidity_batch_failed" };
}

/** v16 batch path without verify — repro only (false success on partial purge). */
export async function executeUidValidityResetV16WithoutVerify(db, updateStmt, deleteStmt) {
  const batchResults = await db.batch([updateStmt, deleteStmt]);
  const updChanges = batchResults?.[0]?.meta?.changes ?? 0;
  const delChanges = batchResults?.[1]?.meta?.changes ?? 0;
  if (updChanges === 0) {
    return { ok: false, reason: "uidvalidity_conflict", updChanges: 0, delChanges, engine: "v16_batch_no_verify" };
  }
  return { ok: true, updChanges, delChanges, engine: "v16_batch_no_verify" };
}

export async function executeUidValidityReset(db, updateStmt, deleteStmt, verifyStmt) {
  const verify = verifyStmt || null;
  if (typeof db.execTransaction === "function") {
    try {
      const out = await db.execTransaction(async () => {
        const updResult = await updateStmt.run();
        const updChanges = updResult?.meta?.changes ?? 0;
        if (updChanges === 0) {
          const err = new Error(ABORT);
          err.code = ABORT;
          throw err;
        }
        const delResult = await deleteStmt.run();
        const delChanges = delResult?.meta?.changes ?? 0;
        if (verify) {
          await verify.run();
        }
        return { updChanges, delChanges, engine: "execTransaction" };
      });
      return { ok: true, ...out };
    } catch (e) {
      return mapResetError(e);
    }
  }
  if (typeof db.batch !== "function") {
    return { ok: false, reason: "uidvalidity_batch_not_supported", cloudflareD1: "NOT_VERIFIED" };
  }
  try {
    const stmts = verify ? [updateStmt, deleteStmt, verify] : [updateStmt, deleteStmt];
    const batchResults = await db.batch(stmts);
    const updChanges = batchResults?.[0]?.meta?.changes ?? 0;
    const delChanges = batchResults?.[1]?.meta?.changes ?? 0;
    if (updChanges === 0) {
      return {
        ok: false,
        reason: "uidvalidity_conflict",
        updChanges: 0,
        delChanges,
        engine: "batch_transition_token",
      };
    }
    return { ok: true, updChanges, delChanges, engine: "batch_transition_token" };
  } catch (e) {
    return mapResetError(e);
  }
}

/** v15 D1 batch path (repro) — DELETE only checks target uidvalidity, not transition owner. */
export function buildUidValidityResetStatementsV15(db, params) {
  const {
    defaultMailbox,
    defaultFolder,
    prev,
    cur,
    ts,
    globalLeaseId,
    runId,
    nowIsoLease,
  } = params;
  const { leaseGate } = UIDVALIDITY_RESET_SQL;
  const updateStmt = db
    .prepare(
      `UPDATE sync_checkpoint SET uidvalidity = ?, completed_uids_json = '[]', updated_at = ?
       WHERE mailbox = ? AND folder = ?
       AND (uidvalidity IS NULL OR uidvalidity = ?)
       AND ${leaseGate}`
    )
    .bind(cur, ts, defaultMailbox, defaultFolder, prev, globalLeaseId, runId, nowIsoLease);
  const deleteStmt = db
    .prepare(
      `DELETE FROM completed_uids
       WHERE mailbox = ? AND folder = ? AND uidvalidity = ?
       AND EXISTS (
         SELECT 1 FROM sync_checkpoint sc
         WHERE sc.mailbox = ? AND sc.folder = ? AND sc.uidvalidity = ?
       )
       AND ${leaseGate}`
    )
    .bind(
      defaultMailbox,
      defaultFolder,
      prev,
      defaultMailbox,
      defaultFolder,
      cur,
      globalLeaseId,
      runId,
      nowIsoLease
    );
  return { updateStmt, deleteStmt };
}

export async function executeUidValidityResetV15Batch(db, updateStmt, deleteStmt) {
  const batchResults = await db.batch([updateStmt, deleteStmt]);
  return {
    ok: true,
    updChanges: batchResults?.[0]?.meta?.changes ?? 0,
    delChanges: batchResults?.[1]?.meta?.changes ?? 0,
    engine: "v15_batch",
  };
}

export function buildUidValidityResetStatementsV14DeleteFirst(db, params) {
  const {
    defaultMailbox,
    defaultFolder,
    prev,
    cur,
    ts,
    globalLeaseId,
    runId,
    nowIsoLease,
  } = params;
  const { leaseGate } = UIDVALIDITY_RESET_SQL;
  const deleteStmt = db
    .prepare(
      `DELETE FROM completed_uids
       WHERE mailbox = ? AND folder = ? AND uidvalidity = ?
       AND ${leaseGate}`
    )
    .bind(defaultMailbox, defaultFolder, prev, globalLeaseId, runId, nowIsoLease);
  const updateStmt = db
    .prepare(
      `UPDATE sync_checkpoint SET uidvalidity = ?, completed_uids_json = '[]', updated_at = ?
       WHERE mailbox = ? AND folder = ?
       AND (uidvalidity IS NULL OR uidvalidity = ?)
       AND ${leaseGate}`
    )
    .bind(cur, ts, defaultMailbox, defaultFolder, prev, globalLeaseId, runId, nowIsoLease);
  return { deleteStmt, updateStmt };
}

export async function executeUidValidityResetV14DeleteFirst(db, deleteStmt, updateStmt) {
  const batchResults = await db.batch([deleteStmt, updateStmt]);
  return {
    updChanges: batchResults?.[1]?.meta?.changes ?? 0,
    delChanges: batchResults?.[0]?.meta?.changes ?? 0,
  };
}

export function simulateV15ApplyResultAfterBatch(resetOut, checkpointUvAfter, cur) {
  if ((resetOut.updChanges ?? 0) === 0) {
    if (checkpointUvAfter != null && Number(checkpointUvAfter) === Number(cur)) {
      return { ok: true, changed: true, reset: true, idempotent: true, falseSuccess: true };
    }
    return { ok: false, reason: "uidvalidity_conflict" };
  }
  return { ok: true, changed: true, reset: true, atomicEngine: resetOut.engine };
}

/** v16 false success when UPDATE ok, DELETE 0, orphans remain. */
export function simulateV16FalseSuccessAfterBatch(resetOut, orphanCount, cur, checkpointUvAfter) {
  if (resetOut.ok && (resetOut.delChanges ?? 0) === 0 && orphanCount > 0 && Number(checkpointUvAfter) === Number(cur)) {
    return { ok: true, falseSuccess: true, partialPurge: true };
  }
  return resetOut;
}
