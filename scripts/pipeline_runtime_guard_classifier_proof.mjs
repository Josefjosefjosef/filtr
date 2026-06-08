#!/usr/bin/env node
/**
 * Phase 3D-B proof: pipeline-runtime-guard uses ingest+aggregate job timing.
 */
import {
  aggregateJobCompletionMs,
  derivePipelineOverallStatus,
  ingestAggregateJobsSucceeded,
} from "./iu_pipeline_run_classifier.mjs";

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed += 1;
  }
}

const jobs = [
  {
    name: "article_pipeline_ingest",
    conclusion: "success",
    started_at: "2026-06-07T10:00:00Z",
    completed_at: "2026-06-07T10:10:00Z",
  },
  {
    name: "article_pipeline_aggregate",
    conclusion: "success",
    started_at: "2026-06-07T10:10:00Z",
    completed_at: "2026-06-07T10:40:00Z",
  },
  {
    name: "article_data_release",
    conclusion: "failure",
  },
];

assert(ingestAggregateJobsSucceeded(jobs), "ingest+aggregate jobs succeeded");

const blockedStatus = {
  ingest_status: "INGEST_OK",
  aggregate_status: "AGGREGATE_OK",
  release_status: "RELEASE_BLOCKED",
  publish_status: "PUBLISH_SKIPPED",
};
const overall = derivePipelineOverallStatus(blockedStatus, {
  jobs,
  runConclusion: "failure",
});
assert(overall === "INGEST_SUCCESS_RELEASE_BLOCKED", "release blocked run classified for runtime pool");

const ms = aggregateJobCompletionMs(jobs, "2026-06-07T09:55:00Z");
assert(ms === 30 * 60 * 1000, "runtime uses aggregate job duration (~30m)");

const releaseFailJobs = [
  { name: "article_pipeline_ingest", conclusion: "failure" },
  { name: "article_pipeline_aggregate", conclusion: "skipped" },
];
assert(!ingestAggregateJobsSucceeded(releaseFailJobs), "ingest fail excluded from runtime sample");

console.log("PIPELINE_RUNTIME_GUARD_CLASSIFIER_PROOF=" + (failed === 0 ? "PASS" : "FAIL"));
console.log("WORKFLOW_CONCLUSION_CHANGE=NO");
process.exit(failed === 0 ? 0 : 1);
