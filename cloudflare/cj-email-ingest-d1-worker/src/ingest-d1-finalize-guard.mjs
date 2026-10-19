/** Shared finalize preconditions (SQL + mock parity). */

export const FINALIZE_REQUIRED_STAGE = "v15_done";



export function parseResultsSummary(json) {

  if (!json || typeof json !== "string") return null;

  try {

    const v = JSON.parse(json);

    return v && typeof v === "object" ? v : null;

  } catch {

    return null;

  }

}



export function buildMessageKey(mailbox, uidvalidity, uid) {

  return String(mailbox) + ":" + String(uidvalidity) + ":" + String(uid);

}



const FINALIZE_AUTH_BYPASS_KEYS = Object.freeze([

  "requireLease",

  "skipLease",

  "leaseBypass",

  "bypassLease",

  "ignoreLease",

]);



function isExplicitLeaseBypassValue(v) {

  return v === false || v === 0 || v === "0" || v === "false";

}



/** Strip auth bypass attempts; production finalize always requires an active lease holder. */

export function sanitizeFinalizePatch(finalPatch = {}) {

  if (!finalPatch || typeof finalPatch !== "object" || Array.isArray(finalPatch)) {

    return { ok: false, reason: "finalize_patch_invalid" };

  }

  if (finalPatch.publishable === true) {

    return { ok: false, reason: "finalize_publishable_forbidden" };

  }

  for (const key of FINALIZE_AUTH_BYPASS_KEYS) {

    if (!(key in finalPatch)) continue;

    const v = finalPatch[key];

    if (key === "requireLease" && isExplicitLeaseBypassValue(v)) {

      return { ok: false, reason: "finalize_lease_bypass_forbidden" };

    }

    if (key === "skipLease" && (v === true || v === 1 || v === "1" || v === "true")) {

      return { ok: false, reason: "finalize_lease_bypass_forbidden" };

    }

    if ((key === "leaseBypass" || key === "bypassLease" || key === "ignoreLease") && v) {

      return { ok: false, reason: "finalize_lease_bypass_forbidden" };

    }

  }

  const runId = typeof finalPatch.runId === "string" ? finalPatch.runId.trim() : "";

  if (!runId) {

    return { ok: false, reason: "finalize_lease_run_id_required" };

  }

  const patch = { runId };

  if (finalPatch.expectedUidvalidity != null) {

    patch.expectedUidvalidity = finalPatch.expectedUidvalidity;

  }

  return { ok: true, patch };

}



export function evaluateFinalizePreconditions(row, finalPatch = {}) {

  if (!row) return { ok: false, reason: "lifecycle_missing" };

  if (row.stage === "completed") {

    const raw = row.raw_snapshot_json ?? row.rawSnapshot ?? null;

    const resultsJson = row.results_summary_json ?? row.resultsSummary ?? null;

    if (resultsJson == null || !raw) {

      return { ok: false, reason: "finalize_repair_blocked_incomplete_record" };

    }

    const summary =

      typeof resultsJson === "string" ? parseResultsSummary(resultsJson) : resultsJson;

    if (!summary || (summary.stagingState == null && summary.v15Blockers == null)) {

      return { ok: false, reason: "finalize_repair_blocked_v15_not_recorded" };

    }

    if (!finalPatch.runId) {

      return { ok: false, reason: "finalize_lease_run_id_required" };

    }

    return { ok: true, repairOnly: true, stage: "completed" };

  }

  if (row.stage === "failed" || row.fail_reason) {

    return { ok: false, reason: "finalize_blocked_failed_stage" };

  }

  if (row.stage !== FINALIZE_REQUIRED_STAGE) {

    return { ok: false, reason: "finalize_blocked_stage", stage: row.stage };

  }

  const raw = row.raw_snapshot_json ?? row.rawSnapshot ?? null;

  if (!raw || String(raw).trim() === "" || String(raw).trim() === "null") {

    return { ok: false, reason: "finalize_blocked_missing_raw" };

  }

  const resultsJson = row.results_summary_json ?? row.resultsSummary ?? null;

  if (resultsJson == null) {

    return { ok: false, reason: "finalize_blocked_missing_results" };

  }

  const summary =

    typeof resultsJson === "string" ? parseResultsSummary(resultsJson) : resultsJson;

  if (!summary || typeof summary !== "object") {

    return { ok: false, reason: "finalize_blocked_invalid_results" };

  }

  if (summary.stagingState == null && summary.v15Blockers == null) {

    return { ok: false, reason: "finalize_blocked_v15_not_recorded" };

  }

  if (summary.aiState === "pending" || summary.aiState === "invalid_ai_json") {

    return { ok: false, reason: "finalize_blocked_ai_incomplete" };

  }

  const mailbox = row.mailbox;

  const uv = row.uidvalidity;

  const uid = row.uid;

  const expectedKey = buildMessageKey(mailbox, uv, uid);

  if (row.msg_key && row.msg_key !== expectedKey && row.key && row.key !== expectedKey) {

    return { ok: false, reason: "finalize_identity_mismatch" };

  }

  const key = row.msg_key || row.key || expectedKey;

  if (finalPatch.expectedUidvalidity != null && Number(finalPatch.expectedUidvalidity) !== Number(uv)) {

    return { ok: false, reason: "finalize_uidvalidity_mismatch" };

  }

  if (finalPatch.publishable === true) {

    return { ok: false, reason: "finalize_publishable_forbidden" };

  }

  if (!finalPatch.runId) {

    return { ok: false, reason: "finalize_lease_run_id_required" };

  }

  return { ok: true, ready: true, key, summary, uidvalidity: Number(uv), uid: Number(uid), mailbox };

}

