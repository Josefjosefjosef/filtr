#!/usr/bin/env node
/**
 * Phase 3D-B proof: articles-continuous-update-guard streak semantics (fixtures, no network).
 */
import {
  INGEST_SUCCESS_RELEASE_BLOCKED,
  INGEST_FAILED,
  PIPELINE_SUCCESS,
  RELEASE_FAILED,
  UNKNOWN_INCOMPLETE,
  alertLevelForOverallStatus,
  derivePipelineOverallStatus,
  isIngestAggregateOkStatus,
  isPipelineFailureStatus,
} from "./iu_pipeline_run_classifier.mjs";

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed += 1;
  }
}

function countPipelineFailureStreak(rows) {
  let streak = 0;
  for (const overall of rows) {
    if (!isPipelineFailureStatus(overall)) break;
    streak += 1;
  }
  return streak;
}

function countReleaseBlockedStreak(rows) {
  let streak = 0;
  for (const overall of rows) {
    if (overall === PIPELINE_SUCCESS) break;
    if (overall === INGEST_SUCCESS_RELEASE_BLOCKED) streak += 1;
    else break;
  }
  return streak;
}

const blockedStatus = {
  ingest_status: "INGEST_OK",
  aggregate_status: "AGGREGATE_OK",
  clean_pool_status: "CLEAN_POOL_CREATED",
  release_status: "RELEASE_BLOCKED",
  publish_status: "PUBLISH_SKIPPED",
};

const blockedOverall = derivePipelineOverallStatus(blockedStatus);
assert(blockedOverall === INGEST_SUCCESS_RELEASE_BLOCKED, "release blocked maps to YELLOW token");
assert(isIngestAggregateOkStatus(blockedOverall), "blocked counts as ingest+aggregate ok");
assert(!isPipelineFailureStatus(blockedOverall), "blocked is not RED failure streak");

const streakAfterBlocked = countPipelineFailureStreak([
  INGEST_SUCCESS_RELEASE_BLOCKED,
  INGEST_FAILED,
  INGEST_FAILED,
]);
assert(streakAfterBlocked === 0, "YELLOW breaks pipeline failure streak at head");

const streakRed = countPipelineFailureStreak([INGEST_FAILED, INGEST_FAILED, UNKNOWN_INCOMPLETE]);
assert(streakRed === 3, "RED runs accumulate pipeline failure streak");

const releaseBlockedStreak = countReleaseBlockedStreak([
  INGEST_SUCCESS_RELEASE_BLOCKED,
  INGEST_SUCCESS_RELEASE_BLOCKED,
  PIPELINE_SUCCESS,
]);
assert(releaseBlockedStreak === 2, "release blocked streak counts until pipeline success");

assert(alertLevelForOverallStatus(RELEASE_FAILED) === "RED", "release failed is RED");

console.log("CONTINUOUS_UPDATE_GUARD_CLASSIFIER_PROOF=" + (failed === 0 ? "PASS" : "FAIL"));
console.log("PUBLISH_OUTPUT_CHANGE=NO");
console.log("WORKFLOW_CONCLUSION_CHANGE=NO");
process.exit(failed === 0 ? 0 : 1);
