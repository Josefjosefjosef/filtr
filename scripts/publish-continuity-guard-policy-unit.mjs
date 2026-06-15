/**
 * Policy unit tests for publish-continuity-guard local artifact freshness.
 * Run: node scripts/publish-continuity-guard-policy-unit.mjs
 */
import { evaluateLocalArtifactFreshness } from "./publish-continuity-guard-lib.mjs";

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed += 1;
  }
}

function isoMinutesAgo(min, fromMs) {
  return new Date(fromMs - min * 60_000).toISOString();
}

const nowMs = Date.parse("2026-06-15T14:11:49.000Z");
const runStart = "2026-06-15T13:28:14.000Z";

// CASE 1: current workflow artifact age 30.8m, limit 30m, ingest success → PASS
{
  const v = evaluateLocalArtifactFreshness({
    generatedAt: isoMinutesAgo(30.8, nowMs),
    nowMs,
    maxAgeMin: 30,
    runtimeToleranceMin: 60,
    workflowRunStartedAt: runStart,
  });
  assert(v.localArtifactCurrentRun === "YES", "case1 current run");
  assert(v.releaseAllowed === "YES", "case1 release allowed");
  console.log("PASS case1_current_run_30_8m_within_tolerance");
}

// CASE 2: current workflow artifact age 45m, limit 30m, within tolerance → PASS
{
  const v = evaluateLocalArtifactFreshness({
    generatedAt: isoMinutesAgo(45, nowMs),
    nowMs,
    maxAgeMin: 30,
    runtimeToleranceMin: 60,
    workflowRunStartedAt: runStart,
  });
  assert(v.localArtifactCurrentRun === "YES", "case2 current run");
  assert(v.releaseAllowed === "YES", "case2 release allowed at 45m");
  console.log("PASS case2_current_run_45m_within_tolerance");
}

// CASE 3: old artifact age 90m, not generated in current run → FAIL
{
  const v = evaluateLocalArtifactFreshness({
    generatedAt: isoMinutesAgo(90, nowMs),
    nowMs,
    maxAgeMin: 30,
    runtimeToleranceMin: 60,
    workflowRunStartedAt: runStart,
  });
  assert(v.localArtifactCurrentRun === "NO", "case3 not current run");
  assert(v.releaseAllowed === "NO", "case3 must fail");
  console.log("PASS case3_old_artifact_90m_blocked");
}

// CASE 4: prod stale scenario — local current-run artifact must not be blocked by 30m base limit
{
  const v = evaluateLocalArtifactFreshness({
    generatedAt: isoMinutesAgo(35, nowMs),
    nowMs,
    maxAgeMin: 30,
    runtimeToleranceMin: 60,
    workflowRunStartedAt: runStart,
    githubRunId: "27549616346",
    artifactPipelineRunId: "27549616346",
  });
  assert(v.releaseAllowed === "YES", "case4 current run by run id must pass");
  console.log("PASS case4_current_run_by_pipeline_run_id");
}

// CASE 5: no artifact / broken artifact / invalid generatedAt → FAIL
{
  const v = evaluateLocalArtifactFreshness({
    generatedAt: null,
    nowMs,
    maxAgeMin: 30,
    runtimeToleranceMin: 60,
    workflowRunStartedAt: runStart,
  });
  assert(v.releaseAllowed === "NO", "case5 missing generatedAt must fail");
  assert(v.failReason?.includes("missing generatedAt"), "case5 reason");
  console.log("PASS case5_invalid_generatedAt_blocked");
}

// CASE 6: current run (by run id) but beyond effective limit → FAIL (safety ceiling)
{
  const v = evaluateLocalArtifactFreshness({
    generatedAt: isoMinutesAgo(95, nowMs),
    nowMs,
    maxAgeMin: 30,
    runtimeToleranceMin: 60,
    workflowRunStartedAt: runStart,
    githubRunId: "27549616346",
    artifactPipelineRunId: "27549616346",
  });
  assert(v.localArtifactCurrentRun === "YES", "case6 current run by run id");
  assert(v.releaseAllowed === "NO", "case6 beyond 90m effective limit must fail");
  console.log("PASS case6_current_run_beyond_ceiling_blocked");
}

console.log("PUBLISH_CONTINUITY_GUARD_POLICY_UNIT=" + (failed === 0 ? "PASS" : "FAIL"));
process.exit(failed === 0 ? 0 : 1);
