/** Shared message stage transition rules (SQL API + mock parity). */

export const MESSAGE_PROGRESS_STAGES = Object.freeze([
  "fetched",
  "raw_persisted",
  "classified",
  "ai_done",
  "v15_done",
]);

export const MESSAGE_TERMINAL_STAGES = Object.freeze(["completed", "failed"]);

/** Explicit allowed next stages (classified may skip ai_done when pipeline skips AI). */
export const ALLOWED_NEXT_STAGE = Object.freeze({
  fetched: ["raw_persisted"],
  raw_persisted: ["classified"],
  classified: ["ai_done", "v15_done"],
  ai_done: ["v15_done"],
  v15_done: [],
});

const BYPASS_KEYS = Object.freeze(["skipLease", "requireLease", "leaseBypass", "bypassLease", "ignoreLease"]);

function isBypassValue(key, v) {
  if (key === "requireLease") return v === false || v === 0 || v === "0" || v === "false";
  if (key === "skipLease") return v === true || v === 1 || v === "1" || v === "true";
  return Boolean(v);
}

export function sanitizeStageTransitionPatch(patch = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, reason: "transition_patch_invalid" };
  }
  for (const key of BYPASS_KEYS) {
    if (key in patch && isBypassValue(key, patch[key])) {
      return { ok: false, reason: "transition_lease_bypass_forbidden" };
    }
  }
  if (patch.publishable === true) {
    return { ok: false, reason: "transition_publishable_forbidden" };
  }
  const runId = typeof patch.runId === "string" ? patch.runId.trim() : "";
  if (!runId) {
    return { ok: false, reason: "transition_lease_run_id_required" };
  }
  const safe = { runId };
  for (const k of Object.keys(patch)) {
    if (k === "runId" || BYPASS_KEYS.includes(k)) continue;
    safe[k] = patch[k];
  }
  return { ok: true, patch: safe };
}

export function evaluateStageTransition(currentStage, nextStage) {
  if (nextStage === "completed") {
    return { ok: false, reason: "transition_completed_requires_finalize" };
  }
  if (nextStage === "failed") {
    return { ok: false, reason: "transition_failed_use_mark_failed" };
  }
  if (currentStage === "completed") {
    return { ok: false, reason: "already_completed" };
  }
  if (currentStage === "failed") {
    return { ok: false, reason: "transition_failed_restart_requires_begin_message" };
  }
  if (MESSAGE_PROGRESS_STAGES.indexOf(currentStage) < 0) {
    return { ok: false, reason: "invalid_stage" };
  }
  if (nextStage === currentStage) {
    return { ok: true, idempotent: true, stage: nextStage };
  }
  const allowed = ALLOWED_NEXT_STAGE[currentStage] || [];
  if (!allowed.includes(nextStage)) {
    if (MESSAGE_PROGRESS_STAGES.indexOf(nextStage) < 0) {
      return { ok: false, reason: "invalid_stage" };
    }
    return { ok: false, reason: "transition_stage_skip_blocked" };
  }
  return { ok: true, stage: nextStage };
}
