#!/usr/bin/env node
/**
 * Static contract proof: Merge Queue merge_group + duplicate push early-exit.
 * No product runtime; CI orchestration only.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  allowsDataOnlyFastPath,
  isDataOnlyScope,
  isWorkflowOnlyScope,
  touchesInfoEventsGeneratedData,
} from "../smoke-data-only-scope.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL: " + msg);
    failed += 1;
  } else {
    console.log("PASS: " + msg);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

const smoke = read(".github/workflows/smoke.yml");
const layout = read(".github/workflows/layout-guard.yml");
const repo = read(".github/workflows/repo-guard.yml");
const skipSh = read("scripts/ci/skip-push-if-pr-open.sh");
const postSh = read("scripts/ci/post-required-status.sh");

// --- merge_group triggers ---
assert(/\n\s*merge_group:\s*\n/.test(smoke) || /merge_group:/.test(smoke), "smoke.yml has merge_group trigger");
assert(/merge_group:/.test(layout), "layout-guard.yml has merge_group trigger");
assert(/merge_group:/.test(repo), "repo-guard.yml has merge_group trigger");

// --- concurrency isolates merge_group from push/PR/CHMI ---
assert(
  /smoke-\$\{\{\s*github\.event\.merge_group\.head_sha/.test(smoke),
  "smoke concurrency keys merge_group.head_sha"
);
assert(
  /layout-guard-\$\{\{\s*github\.event\.merge_group\.head_sha/.test(layout),
  "layout concurrency keys merge_group.head_sha"
);
assert(
  /repo-guard-\$\{\{\s*github\.event\.merge_group\.head_sha/.test(repo),
  "repo-guard concurrency keys merge_group.head_sha"
);
assert(/\$\{\{\s*github\.event_name\s*\}\}/.test(smoke), "smoke concurrency includes event_name");

// --- smoke real early-exit via smoke-gate ---
assert(/smoke-gate:/.test(smoke), "smoke.yml defines smoke-gate job");
assert(/needs:\s*smoke-gate/.test(smoke), "smoke job needs smoke-gate");
assert(/needs\.smoke-gate\.outputs\.skip\s*!=\s*'true'/.test(smoke), "smoke job skipped when gate skip=true");
assert(/SMOKE_PUSH_SKIPPED_PR_OWNS_CHECK=YES/.test(smoke), "smoke-gate emits early-exit ack");
assert(
  /Do NOT post required status/.test(smoke),
  "smoke-gate must not post required status (PR owns)"
);
// Full smoke must not still only log skip without gating the job
assert(
  !/IU_SKIP_PUSH_IF_PR_OPEN/.test(smoke),
  "smoke.yml must not use obsolete IU_SKIP_PUSH_IF_PR_OPEN log-only path"
);

// --- merge_group SHA wiring ---
assert(/MERGE_GROUP_SHA_CONTRACT=PASS/.test(smoke), "smoke has merge-group SHA contract step");
assert(/MERGE_GROUP_SHA_CONTRACT=PASS/.test(layout), "layout has merge-group SHA contract step");
assert(
  /github\.event\.merge_group\.base_sha/.test(smoke) && /github\.event\.merge_group\.head_sha/.test(smoke),
  "smoke scope uses merge_group base/head SHA"
);
assert(
  /github\.event\.merge_group\.base_sha/.test(layout) && /github\.event\.merge_group\.head_sha/.test(layout),
  "layout scope uses merge_group base/head SHA"
);

// --- status publisher ---
assert(/EVENT_NAME.*=.*merge_group/.test(postSh) || /merge_group/.test(postSh), "post-required-status handles merge_group");
assert(/MERGE_GROUP_HEAD_SHA|MERGE_GROUP_SHA/.test(postSh), "post-required-status can take merge-group SHA");
assert(/status_post_merge_group_sha=/.test(postSh), "post-required-status logs merge-group SHA");

// --- skip script never skips merge_group ---
assert(/merge_group/.test(skipSh), "skip-push-if-pr-open mentions merge_group");
assert(
  /EVENT_NAME.*=.*merge_group[\s\S]*skip_push_if_pr_open=NO/.test(skipSh),
  "skip-push-if-pr-open never skips merge_group"
);

// --- layout early-exit before heavy work ---
assert(/LAYOUT_GUARD_PUSH_SKIPPED_PR_OWNS_CHECK=YES/.test(layout), "layout early-exit ack");
assert(
  /if:\s*steps\.prgate\.outputs\.skip\s*!=\s*'true'[\s\S]*npm ci/.test(layout) ||
    /run: npm ci\s*\n\s*if:\s*steps\.prgate\.outputs\.skip\s*!=\s*'true'/.test(layout),
  "layout npm ci gated on skip != true"
);

// --- classifier: pure CHMI / code / mixed / workflow+ci ---
const chmi = [
  "projects/data/info_events/feed.json",
  "projects/data/info_events/chmi_cap_v2/sync_state.json",
];
const code = ["assets/app.js"];
const mixed = [...chmi, "cloudflare/iu-analytics/src/index.ts"];
const wfCi = [
  ".github/workflows/smoke.yml",
  "scripts/ci/post-required-status.sh",
  "scripts/smoke-data-only-scope.mjs",
];

assert(isDataOnlyScope(chmi) && allowsDataOnlyFastPath(chmi), "pure CHMI → data-only fast path");
assert(touchesInfoEventsGeneratedData(chmi), "pure CHMI → info_events contract");
assert(!allowsDataOnlyFastPath(code), "code → NOT data-only");
assert(!allowsDataOnlyFastPath(mixed), "mixed code+data → NOT data-only (full CI)");
assert(isWorkflowOnlyScope(wfCi) && allowsDataOnlyFastPath(wfCi), "workflows+scripts/ci → workflow-only fast path");

if (failed) {
  console.error(`merge-group-ci-contract-proof FAILED count=${failed}`);
  process.exit(1);
}
console.log("merge-group-ci-contract-proof PASS");
