#!/usr/bin/env node
/**
 * Synthetic NDIC concurrency architecture fixtures (offline, no dispatch, no NDIC network).
 *
 * Narrow-lock architecture:
 * - Prep uses ndic-datex-v1-internal-staging (never workflow-level shared lock).
 * - Active shared-write job uses info-events-data-writers.
 * - CHMI/IE hold shared lock only on shared-write jobs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NDIC_WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");
const CHMI_WF = path.join(ROOT, ".github", "workflows", "update-chmi-cap-v2.yml");
const IE_WF = path.join(ROOT, ".github", "workflows", "update-info-events.yml");

export const NDIC_STAGING_GROUP = "ndic-datex-v1-internal-staging";
export const PRODUCTION_ACTIVATION_GROUP = "info-events-data-writers";

const fails = [];
let passCount = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else passCount += 1;
}

/** Resolve which group an ACTIVE vs shadow path should use (job-level model). */
export function resolveNdicConcurrencyGroup(mode) {
  const m = String(mode || "");
  return m === "active" ? PRODUCTION_ACTIVATION_GROUP : NDIC_STAGING_GROUP;
}

/** Extract first concurrency block (may be workflow or job level). */
export function extractConcurrencyBlock(src) {
  const m = src.match(/(?:^|\n)\s*concurrency:\s*\n((?:[ \t]+.+\n)+)/);
  return m ? m[1] : "";
}

export function parseConcurrency(src) {
  const block = extractConcurrencyBlock(src);
  const groupLine = (block.match(/group:\s*(.+)/) || [])[1] || "";
  const cancelLine = (block.match(/cancel-in-progress:\s*(.+)/) || [])[1] || "";
  return {
    block,
    groupRaw: groupLine.trim(),
    cancelInProgress: cancelLine.trim(),
  };
}

export function isStaticSharedWriterGroup(groupRaw) {
  return /^info-events-data-writers\s*$/.test(groupRaw);
}

/** Legacy helper kept for meta mutations: mode-aware workflow expression. */
export function hasModeAwareGroupExpression(groupRaw) {
  return (
    /inputs\.mode\s*==\s*'active'/.test(groupRaw) ||
    (groupRaw.includes(PRODUCTION_ACTIVATION_GROUP) && groupRaw.includes(NDIC_STAGING_GROUP))
  );
}

export function workflowLevelHasSharedLock(src) {
  const head = src.split(/\njobs:\s*\n/)[0] || "";
  // Only real YAML concurrency blocks (ignore comments mentioning the group name).
  const stripped = head
    .split("\n")
    .filter((ln) => !/^\s*#/.test(ln))
    .join("\n");
  return /(?:^|\n)concurrency:\s*\n[\s\S]*?group:\s*info-events-data-writers/.test(stripped);
}

export function jobBlock(src, jobName) {
  const re = new RegExp(
    "(?:^|\\n)\\s*" + jobName + ":\\s*\\n([\\s\\S]*?)(?=\\n\\s{0,2}[a-zA-Z0-9_-]+:\\s*\\n|$)"
  );
  const m = src.match(re);
  return m ? m[1] : "";
}

export function jobHasGroup(src, jobName, group) {
  return new RegExp("group:\\s*" + group.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(jobBlock(src, jobName));
}

/** Simulate pending-replacement semantics (GitHub docs): at most 1 running + 1 pending. */
export function simulatePendingReplacement(state, incoming) {
  const next = { running: state.running, pending: state.pending, cancelled: [] };
  if (!next.running) {
    next.running = incoming;
    return next;
  }
  if (next.pending) next.cancelled.push(next.pending);
  next.pending = incoming;
  return next;
}

function assertNoLiveSideEffects(src) {
  ok("no_test_dispatch", !/gh\s+workflow\s+run/.test(src), "dispatch");
  ok("fixture_file_offline_only", !/IU_NDIC_PULL_URL:\s*https:/.test(src), "secrets");
}

function main() {
  const ndic = fs.readFileSync(NDIC_WF, "utf8");
  const chmi = fs.readFileSync(CHMI_WF, "utf8");
  const ie = fs.readFileSync(IE_WF, "utf8");
  assertNoLiveSideEffects(ndic);

  ok("ndic_no_workflow_shared_lock", !workflowLevelHasSharedLock(ndic), "ndic-wf");
  ok("chmi_no_workflow_shared_lock", !workflowLevelHasSharedLock(chmi), "chmi-wf");
  ok("ie_no_workflow_shared_lock", !workflowLevelHasSharedLock(ie), "ie-wf");

  ok("ndic_prep_staging", jobHasGroup(ndic, "ndic-prep", NDIC_STAGING_GROUP), "prep");
  ok("ndic_write_shared", jobHasGroup(ndic, "ndic-shared-write", PRODUCTION_ACTIVATION_GROUP), "write");
  ok("chmi_write_shared", jobHasGroup(chmi, "shared-write", PRODUCTION_ACTIVATION_GROUP), "chmi-write");
  ok("ie_write_shared", jobHasGroup(ie, "shared-write", PRODUCTION_ACTIVATION_GROUP), "ie-write");

  ok("ndic_cancel_false", /cancel-in-progress:\s*false/.test(ndic), "cancel");
  ok("chmi_cancel_false", /cancel-in-progress:\s*false/.test(chmi), "chmi-cancel");
  ok("ie_cancel_false", /cancel-in-progress:\s*false/.test(ie), "ie-cancel");

  ok("mode_off_staging", resolveNdicConcurrencyGroup("off") === NDIC_STAGING_GROUP, "off");
  ok("mode_shadow_staging", resolveNdicConcurrencyGroup("shadow") === NDIC_STAGING_GROUP, "shadow");
  ok("mode_active_production", resolveNdicConcurrencyGroup("active") === PRODUCTION_ACTIVATION_GROUP, "active");

  ok("shadow_ne_chmi_group", resolveNdicConcurrencyGroup("shadow") !== PRODUCTION_ACTIVATION_GROUP, "collision");
  ok("active_eq_chmi_group", resolveNdicConcurrencyGroup("active") === PRODUCTION_ACTIVATION_GROUP, "active-lock");

  {
    const s0 = { running: "chmi-write", pending: null };
    const s1 = simulatePendingReplacement(s0, "ndic-active-write");
    ok("active_ndic_pending_behind_chmi_write", s1.running === "chmi-write" && s1.pending === "ndic-active-write", "pend");
  }

  {
    const s0 = { running: "ndic-a", pending: null };
    const s1 = simulatePendingReplacement(s0, "ndic-b");
    ok("two_ndic_pending_slot", s1.running === "ndic-a" && s1.pending === "ndic-b", "slot");
    const s2 = simulatePendingReplacement(s1, "ndic-c");
    ok("two_ndic_replaces_pending", s2.pending === "ndic-c" && s2.cancelled.includes("ndic-b"), "repl");
  }

  ok("ndic_dispatch_only", /workflow_dispatch\s*:/.test(ndic) && !/^\s*schedule\s*:/m.test(ndic), "sched");
  ok("ndic_default_off", /default:\s*off\b/.test(ndic), "def");
  ok("ndic_commit_active_only", /ndic-shared-write:/.test(ndic) && /mode == 'active'/.test(ndic), "commit");
  ok("ndic_apply_reread", /info-events-shared-writer-critical\.mjs ndic/.test(ndic), "reread");
  ok("chmi_pages_outside_lock", /post-write:/.test(chmi) && /pages\.yml/.test(jobBlock(chmi, "post-write")), "pages");

  const report = {
    suite: "NDIC_DATEX_V1_CONCURRENCY_FIXTURES",
    total: passCount + fails.length,
    success: passCount,
    failure: fails.length,
    skipped: 0,
    stagingGroup: NDIC_STAGING_GROUP,
    productionActivationGroup: PRODUCTION_ACTIVATION_GROUP,
    resolved: {
      off: resolveNdicConcurrencyGroup("off"),
      shadow: resolveNdicConcurrencyGroup("shadow"),
      active: resolveNdicConcurrencyGroup("active"),
    },
    fails,
  };

  if (fails.length) {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
