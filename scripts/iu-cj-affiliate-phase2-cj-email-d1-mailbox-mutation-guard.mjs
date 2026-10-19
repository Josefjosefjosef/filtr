/** beginMessage + applyUidValidityChange patch rules (lease, no bypass). */
import {
  sanitizeIngestMutationPatch,
  mapLeaseReasonToMutation,
} from "./iu-cj-affiliate-phase2-cj-email-d1-ingest-mutation-guard.mjs";

export { mapLeaseReasonToMutation };

export function sanitizeBeginMessagePatch(patch = {}) {
  return sanitizeIngestMutationPatch(patch, { reasonPrefix: "begin_message" });
}

export function sanitizeUidValidityPatch(patch = {}) {
  const base = sanitizeIngestMutationPatch(patch, { reasonPrefix: "uidvalidity" });
  if (!base.ok) return base;
  const safe = base.patch;
  if (patch.expectedPreviousUidvalidity != null) {
    safe.expectedPreviousUidvalidity = patch.expectedPreviousUidvalidity;
  }
  return { ok: true, patch: safe };
}

export function sanitizeRecordIngestJobPatch(job = {}, patch = {}) {
  const runId = typeof job?.runId === "string" ? job.runId.trim() : "";
  const merged = Object.assign(Object.create(null), patch, { runId: patch.runId || runId });
  return sanitizeIngestMutationPatch(merged, { reasonPrefix: "record_ingest_job" });
}
