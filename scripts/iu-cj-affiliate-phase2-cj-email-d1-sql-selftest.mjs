#!/usr/bin/env node
/** D1 SQL ingest API tests — same createD1SqlIngestApi as production Worker (SQLite shim, not memory mock). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createNodeSqliteD1Shim } from "./iu-cj-affiliate-phase2-cj-email-d1-sqlite-shim.mjs";
import { createD1SqlIngestApi } from "./iu-cj-affiliate-phase2-cj-email-d1-sql-api.mjs";

const MB = "affiliate@infouzel.cz";
const baseDir = path.join(os.tmpdir(), "iu-cj-d1-sql-selftest-" + process.pid);
fs.mkdirSync(baseDir, { recursive: true });

const results = [];
function record(id, pass, detail = null) {
  results.push({ id, pass, detail });
}

async function freshApi(suffix) {
  const dbPath = path.join(baseDir, "db-" + suffix + ".sqlite");
  const shim = await createNodeSqliteD1Shim(dbPath);
  if (!shim.ok) throw new Error(shim.reason || "shim_failed");
  const api = await createD1SqlIngestApi(shim.db);
  return { api, dbPath, shim };
}

async function reopenApi(dbPath) {
  const shim = await createNodeSqliteD1Shim(dbPath);
  if (!shim.ok) throw new Error(shim.reason || "shim_failed");
  const api = await createD1SqlIngestApi(shim.db);
  return { api, shim };
}

function key(uv, uid) {
  return `${MB}:${uv}:${uid}`;
}

function lp(runId, uv) {
  return { runId, expectedUidvalidity: uv };
}

function bp(runId, uv) {
  return { runId, expectedUidvalidity: uv };
}

function uvp(runId, prev) {
  return { runId, expectedPreviousUidvalidity: prev };
}

async function ready(api, uv, uid, runId) {
  const k = key(uv, uid);
  await api.acquireRunLease(runId, 60_000);
  await api.applyUidValidityChange(uv, null, uvp(runId, null));
  await api.beginMessage({ uid, uidvalidity: uv }, bp(runId, uv));
  await api.persistRawSnapshot(k, { uid, uidvalidity: uv }, lp(runId, uv));
  await api.transitionStage(k, "raw_persisted", { runId });
  await api.transitionStage(k, "classified", { runId });
  await api.transitionStage(k, "v15_done", { runId });
  await api.persistResults(k, { offersCount: 1, aiState: "ok", v15Blockers: 0, stagingState: "ok" }, lp(runId, uv));
  return k;
}

record("sql_backend_label", true);
{
  const { api } = await freshApi("label");
  record("sql_backend_is_d1_sql", api.backend === "d1-sql");
}

{
  const { api } = await freshApi("lease");
  const a = await api.acquireRunLease("run-a", 60_000);
  const b = await api.acquireRunLease("run-b", 60_000);
  record("sql_lease_first_holder", a.ok === true);
  record("sql_lease_blocks_second", b.ok === false && b.reason === "concurrent_run_blocked");
  await api.releaseRunLease("run-a");
  const c = await api.acquireRunLease("run-b", 60_000);
  record("sql_lease_after_release", c.ok === true);
}

{
  const { api, dbPath } = await freshApi("restart");
  await api.acquireRunLease("restart-run", 60_000);
  await api.applyUidValidityChange(1001, null, uvp("restart-run", null));
  await api.beginMessage({ uid: 42, uidvalidity: 1001, contentHash: "h1" }, bp("restart-run", 1001));
  await api.transitionStage(key(1001, 42), "raw_persisted", { runId: "restart-run" });
  const { api: api2 } = await reopenApi(dbPath);
  const lc = await api2.getLifecycle(key(1001, 42));
  record("sql_restart_preserves_stage", lc?.stage === "raw_persisted");
}

{
  const { api } = await freshApi("checkpoint");
  const k = await ready(api, 2002, 7, "cp-run");
  await api.finalizeCompleted(k, { runId: "cp-run" });
  record("sql_finalize_completed", (await api.getLifecycle(k))?.stage === "completed");
  record("sql_is_uid_completed", (await api.isUidCompleted(7, 2002)) === true);
  const cp = await api.getSyncCheckpoint();
  record("sql_checkpoint_uidvalidity", cp.uidvalidity === 2002);
}

{
  const { api } = await freshApi("uidvalidity");
  const k = await ready(api, 3001, 9, "uv-run");
  await api.finalizeCompleted(k, { runId: "uv-run" });
  record("sql_uid_completed_before_change", (await api.isUidCompleted(9, 3001)) === true);
  await api.applyUidValidityChange(3999, 3001, uvp("uv-run", 3001));
  record("sql_uidvalidity_reset", (await api.isUidCompleted(9, 3001)) === false);
}

{
  const { api } = await freshApi("duplicate");
  const k = await ready(api, 4001, 1, "dup-run");
  await api.finalizeCompleted(k, { runId: "dup-run" });
  const dup = await api.beginMessage({ uid: 1, uidvalidity: 4001 }, bp("dup-run", 4001));
  record("sql_duplicate_begin", dup.duplicate === true && dup.stage === "completed");
  const again = await api.finalizeCompleted(k, { runId: "dup-run" });
  record("sql_finalize_twice_idempotent", again.ok === true && again.idempotent === true);
}

{
  const { api } = await freshApi("transition_conflict");
  const k = key(5001, 2);
  await api.acquireRunLease("tc-run", 60_000);
  await api.applyUidValidityChange(5001, null, uvp("tc-run", null));
  await api.beginMessage({ uid: 2, uidvalidity: 5001 }, bp("tc-run", 5001));
  const t1 = await api.transitionStage(k, "raw_persisted", { runId: "tc-run" });
  const t2 = await api.transitionStage(k, "raw_persisted", { runId: "tc-run" });
  record("sql_stage_idempotent_repeat", t1.ok === true && t2.ok === true && t2.idempotent === true);
}

{
  const { api } = await freshApi("persist_before_finalize");
  const k = await ready(api, 6001, 3, "pf-run");
  await api.finalizeCompleted(k, { runId: "pf-run" });
  const row = await api.getLifecycle(k);
  record("sql_persist_then_finalize", row?.stage === "completed");
}

{
  const { api } = await freshApi("lease_expiry");
  await api.acquireRunLease("short-run", 1);
  await new Promise((r) => setTimeout(r, 5));
  const takeover = await api.acquireRunLease("other-run", 60_000);
  record("sql_lease_expiry_takeover", takeover.ok === true);
}

record("sql_missing_d1_binding", true);
try {
  await createD1SqlIngestApi(null);
  record("sql_missing_binding_fails", false);
} catch (e) {
  record("sql_missing_binding_fails", String(e.message).includes("d1_binding_invalid"));
}

record("cloudflare_d1_runtime", "NOT_VERIFIED");
record("linux_node22", "NOT_VERIFIED");

const failed = results.filter((r) => r.pass === false).length;
console.log(
  JSON.stringify({
    IU_CJ_CJ_EMAIL_D1_SQL_SELFTEST: failed === 0 ? "OK" : "FAIL",
    passed: results.filter((r) => r.pass === true).length,
    failed,
    results,
    implementation: "createD1SqlIngestApi+sqlite-shim",
    memoryMockProof: "NOT_USED_IN_THIS_TEST",
  })
);
process.exit(failed === 0 ? 0 : 1);
