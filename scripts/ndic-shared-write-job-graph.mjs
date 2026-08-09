/**
 * Shared helpers for NDIC shared-write job-graph contract (Variant A).
 * Job eligibility must not depend on needs.ndic-prep.outputs.*.
 */
import {
  jobChunk,
  stripComments,
} from "./ndic-staging-preflight-architecture-fixtures.mjs";

export function sharedWriteJobChunk(src) {
  return jobChunk(String(src || ""), "ndic-shared-write") || "";
}

/** YAML text from job start through (not including) runs-on. */
export function sharedWriteIfRegion(src) {
  const write = sharedWriteJobChunk(src);
  const idx = write.search(/\n\s*runs-on:/);
  return idx >= 0 ? write.slice(0, idx) : write;
}

/** Comment-stripped if-region used for eligibility regexes. */
export function sharedWriteIfRegionCode(src) {
  return stripComments(sharedWriteIfRegion(src));
}

export function usesCandidateReadyForJobEligibility(src) {
  return /needs\.ndic-prep\.outputs\.candidate_ready\s*==\s*'true'/.test(
    sharedWriteIfRegionCode(src)
  );
}

export function usesAnyPrepOutputForJobEligibility(src) {
  return /needs\.ndic-prep\.outputs\./.test(sharedWriteIfRegionCode(src));
}

export function usesPrepResultForJobEligibility(src) {
  return /needs\.ndic-prep\.result\s*==\s*'success'/.test(sharedWriteIfRegionCode(src));
}

export function usesCancelledGuardForJobEligibility(src) {
  return /!cancelled\(\)/.test(sharedWriteIfRegionCode(src));
}

/**
 * GitHub-native eligibility model (Variant A).
 * candidateReady is intentionally ignored for job creation.
 */
export function sharedWriteJobWouldStart(ctx) {
  if (ctx.cancelled === true) return false;
  if (ctx.prepResult !== "success") return false;
  const dispatchActive =
    ctx.eventName === "workflow_dispatch" && ctx.mode === "active";
  const scheduleEvent = ctx.eventName === "schedule";
  if (!dispatchActive && !scheduleEvent) return false;
  // Schedule authorization is enforced upstream (prep never succeeds when disarmed /
  // preflight fails). Model that here so fixtures cannot claim schedule START without
  // armed+preflight+head match.
  if (scheduleEvent) {
    if (ctx.automationArmed !== true) return false;
    if (ctx.preflightPass !== true) return false;
    if (ctx.headMatch !== true) return false;
  }
  return true;
}

/**
 * Legacy broken eligibility that caused canaries 31311789781 / 31313465533.
 * When schedule deps are skipped, needs outputs may be empty → false skip.
 */
export function sharedWriteJobWouldStartLegacyCandidateReadyGate(ctx) {
  const candidateReady = ctx.candidateReady === true || ctx.candidateReady === "true";
  // Model the observed false-skip: after skipped schedule jobs, needs outputs empty.
  const effectiveReady =
    ctx.scheduleJobsSkipped === true && ctx.forceEmptyNeedsOutputs === true
      ? false
      : candidateReady;
  if (ctx.prepResult !== "success") return false;
  if (!effectiveReady) return false;
  const dispatchActive =
    ctx.eventName === "workflow_dispatch" && ctx.mode === "active";
  const scheduleEvent = ctx.eventName === "schedule";
  return dispatchActive || scheduleEvent;
}

export function assertSharedWriteJobGraphContract(src) {
  const raw = String(src || "");
  const write = sharedWriteJobChunk(raw);
  const ifRegion = sharedWriteIfRegion(raw);
  const fails = [];
  const check = (id, cond) => {
    if (!cond) fails.push(id);
  };

  check("write_job_present", Boolean(write));
  check("write_needs_prep_only", /^\s*needs:\s*ndic-prep\s*$/m.test(write));
  check("write_uses_cancelled_guard", usesCancelledGuardForJobEligibility(raw));
  check("write_uses_prep_result", usesPrepResultForJobEligibility(raw));
  check(
    "write_no_candidate_ready_eligibility",
    !usesCandidateReadyForJobEligibility(raw)
  );
  check("write_no_prep_outputs_eligibility", !usesAnyPrepOutputForJobEligibility(raw));
  check(
    "write_dispatch_active_gate",
    /github\.event_name == 'workflow_dispatch'/.test(ifRegion) &&
      /github\.event\.inputs\.mode == 'active'/.test(ifRegion)
  );
  check("write_schedule_event_gate", /github\.event_name == 'schedule'/.test(ifRegion));
  check(
    "write_validates_candidate_step",
    /ndic-validate-shared-write-candidate\.mjs/.test(write)
  );
  check(
    "write_download_candidate_artifact",
    /download-artifact/.test(write) && /ndic-ie-candidate-\$\{\{\s*github\.run_id\s*\}\}/.test(write)
  );
  check(
    "prep_writes_producer_binding",
    /ndic-write-candidate-producer-binding\.mjs/.test(raw)
  );
  check(
    "prep_keeps_informational_candidate_ready_output",
    /candidate_ready:\s*\$\{\{\s*steps\.pack\.outputs\.candidate_ready\s*\}\}/.test(raw)
  );

  return { ok: fails.length === 0, fails };
}
