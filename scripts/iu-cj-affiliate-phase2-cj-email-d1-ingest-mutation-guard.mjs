/** Shared lease + bypass rules for mutating ingest D1 operations. */

const BYPASS_KEYS = Object.freeze([
  "skipLease",
  "requireLease",
  "leaseBypass",
  "bypassLease",
  "ignoreLease",
  "force",
  "adminOverride",
]);

function isBypassValue(key, v) {
  if (key === "requireLease") return v === false || v === 0 || v === "0" || v === "false";
  if (key === "skipLease") return v === true || v === 1 || v === "1" || v === "true";
  if (key === "force" || key === "adminOverride") return Boolean(v);
  return Boolean(v);
}

export function sanitizeIngestMutationPatch(patch = {}, opts = {}) {
  const prefix = opts.reasonPrefix || "mutation";
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, reason: `${prefix}_patch_invalid` };
  }
  for (const key of BYPASS_KEYS) {
    if (key in patch && isBypassValue(key, patch[key])) {
      return { ok: false, reason: `${prefix}_lease_bypass_forbidden` };
    }
  }
  if (patch.publishable === true) {
    return { ok: false, reason: `${prefix}_publishable_forbidden` };
  }
  const runId = typeof patch.runId === "string" ? patch.runId.trim() : "";
  if (!runId) {
    return { ok: false, reason: `${prefix}_lease_run_id_required` };
  }
  const safe = { runId };
  if (patch.expectedUidvalidity != null) {
    safe.expectedUidvalidity = patch.expectedUidvalidity;
  }
  return { ok: true, patch: safe };
}

export function mapLeaseReasonToMutation(leaseResult, prefix) {
  if (leaseResult.ok) return leaseResult;
  if (leaseResult.reason === "finalize_lease_missing") {
    return { ok: false, reason: `${prefix}_lease_missing` };
  }
  if (leaseResult.reason === "finalize_lease_holder_mismatch") {
    return { ok: false, reason: `${prefix}_lease_holder_mismatch`, holder: leaseResult.holder };
  }
  return leaseResult;
}
