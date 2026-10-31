#!/usr/bin/env node
/**
 * Real scenario proofs for LKG / fail-closed / circuit breaker / watchdog /
 * idempotence / atomic publication helpers. Prints concrete JSON results.
 */
import {
  evaluateCircuitBreaker,
  evidenceFreshness,
  scheduleWatchdog,
  distinguishEndedVsPartial,
} from "./iu-cj-affiliate-phase3z-ops-guards-v9.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const failures = [];
const proofs = [];
function expect(id, cond, detail) {
  if (!cond) failures.push({ id, detail: detail ?? null });
  else proofs.push({ id, ok: true, detail: detail ?? null });
}

// --- Circuit breaker: partial snapshot → KEEP LKG, no mass delete ---
const cbPartial = evaluateCircuitBreaker({
  previousJoinedCount: 175,
  nextJoinedCount: 10,
  partialSnapshot: true,
});
expect(
  "cb_partial_keep_lkg",
  cbPartial.trip === true && cbPartial.action === "KEEP_LKG_NO_MASS_DELETE",
  cbPartial
);

// --- Circuit breaker: suspicious mass drop without ENDED confirmations ---
const cbMass = evaluateCircuitBreaker({
  previousJoinedCount: 175,
  nextJoinedCount: 50,
  confirmedEndedIds: [],
  partialSnapshot: false,
});
expect("cb_mass_trip", cbMass.trip === true && cbMass.action === "KEEP_LKG_REQUIRE_HUMAN", cbMass);

// --- Circuit breaker: single confirmed ENDED is OK ---
const cbOk = evaluateCircuitBreaker({
  previousJoinedCount: 175,
  nextJoinedCount: 174,
  confirmedEndedIds: ["1"],
  partialSnapshot: false,
});
expect("cb_ok_proceed", cbOk.trip === false && cbOk.action === "PROCEED", cbOk);

// --- Fail-closed: missing IDs without ENDED stay in LKG keep set ---
const ended = distinguishEndedVsPartial({
  missingFromSnapshotIds: ["a", "b", "c"],
  confirmedEndedIds: ["a"],
});
expect(
  "fail_closed_partial_kept",
  ended.treatAsEnded.length === 1 &&
    ended.treatAsPartial.length === 2 &&
    ended.failClosedKeep.includes("b") &&
    ended.failClosedKeep.includes("c"),
  ended
);

// --- Evidence freshness ---
const fresh = evidenceFreshness({ lastReviewedAt: new Date().toISOString(), maxAgeHours: 168 });
expect("evidence_fresh", fresh.fresh === true, fresh);
const stale = evidenceFreshness({
  lastReviewedAt: new Date(Date.now() - 400 * 3600000).toISOString(),
  maxAgeHours: 168,
});
expect("evidence_stale", stale.fresh === false, stale);

// --- Schedule watchdog ---
const wdPending = scheduleWatchdog({ lastScheduleSuccessAt: null });
expect("watchdog_pending", wdPending.status === "PENDING", wdPending);
const wdOk = scheduleWatchdog({
  lastScheduleSuccessAt: new Date(Date.now() - 2 * 3600000).toISOString(),
  maxLagHours: 36,
});
expect("watchdog_ok", wdOk.status === "OK" && wdOk.ok === true, wdOk);
const wdStale = scheduleWatchdog({
  lastScheduleSuccessAt: new Date(Date.now() - 48 * 3600000).toISOString(),
  maxLagHours: 36,
});
expect("watchdog_stale", wdStale.status === "STALE", wdStale);

// --- Idempotence: same payload hash twice → second write skipped ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-ops-idem-"));
const payload = { joined: 175, rulesVersion: "phase3z-partner-robot-v9-final", publicSwapArmed: false };
function atomicWriteJson(target, obj) {
  const body = JSON.stringify(obj);
  const hash = crypto.createHash("sha256").update(body).digest("hex");
  const metaPath = target + ".sha256";
  if (fs.existsSync(metaPath) && fs.existsSync(target)) {
    const prev = fs.readFileSync(metaPath, "utf8").trim();
    if (prev === hash) return { wrote: false, reason: "idempotent_same_hash", hash };
  }
  const tmpFile = target + ".tmp." + process.pid;
  fs.writeFileSync(tmpFile, body);
  fs.renameSync(tmpFile, target); // atomic replace on same filesystem
  fs.writeFileSync(metaPath, hash + "\n");
  return { wrote: true, reason: "written", hash };
}
const target = path.join(tmp, "registry.json");
const w1 = atomicWriteJson(target, payload);
const w2 = atomicWriteJson(target, payload);
expect("idempotent_second_skip", w1.wrote === true && w2.wrote === false && w1.hash === w2.hash, { w1, w2 });

// --- Atomic publication: temp+rename; crash before rename leaves LKG intact ---
const lkg = path.join(tmp, "public.json");
const lkgBody = JSON.stringify({ version: 1, ready: 160 });
fs.writeFileSync(lkg, lkgBody);
const nextTmp = path.join(tmp, "public.json.tmp");
fs.writeFileSync(nextTmp, JSON.stringify({ version: 2, ready: 999, corrupt: true }));
// simulate crash: do NOT rename
const afterCrash = fs.readFileSync(lkg, "utf8");
expect(
  "atomic_crash_keeps_lkg",
  afterCrash === lkgBody && fs.existsSync(nextTmp),
  { lkgBytes: afterCrash.length, tmpExists: fs.existsSync(nextTmp) }
);
// complete atomic publish
fs.renameSync(nextTmp, lkg);
const afterOk = JSON.parse(fs.readFileSync(lkg, "utf8"));
expect("atomic_rename_publishes", afterOk.version === 2 && afterOk.ready === 999, afterOk);

// --- Fail-closed publish gate: DISARMED must refuse public swap ---
function publishGate({ publicButtonSwapArmed, circuitTrip, snapshotPartial }) {
  if (!publicButtonSwapArmed) return { allow: false, reason: "DISARMED" };
  if (snapshotPartial) return { allow: false, reason: "PARTIAL_SNAPSHOT_FAIL_CLOSED" };
  if (circuitTrip) return { allow: false, reason: "CIRCUIT_OPEN_KEEP_LKG" };
  return { allow: true, reason: "ARMED_OK" };
}
const gateDisarmed = publishGate({ publicButtonSwapArmed: false, circuitTrip: false, snapshotPartial: false });
expect("fail_closed_disarmed", gateDisarmed.allow === false && gateDisarmed.reason === "DISARMED", gateDisarmed);
const gatePartial = publishGate({ publicButtonSwapArmed: true, circuitTrip: false, snapshotPartial: true });
expect(
  "fail_closed_partial",
  gatePartial.allow === false && gatePartial.reason === "PARTIAL_SNAPSHOT_FAIL_CLOSED",
  gatePartial
);

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures, proofs }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      ok: true,
      IU_CJ_PHASE3Z_OPS_GUARDS_SELFTEST: "OK",
      proofCount: proofs.length,
      proofs,
    },
    null,
    2
  )
);
