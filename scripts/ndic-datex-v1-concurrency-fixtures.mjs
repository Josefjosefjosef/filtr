#!/usr/bin/env node
/**
 * Synthetic NDIC concurrency architecture fixtures (offline, no dispatch, no NDIC network).
 *
 * Proves isolated staging group vs shared production activation lock with CHMI/info-events.
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

/** Evaluate the documented concurrency group expression for a mode input. */
export function resolveNdicConcurrencyGroup(mode) {
  const m = String(mode || "");
  return m === "active" ? PRODUCTION_ACTIVATION_GROUP : NDIC_STAGING_GROUP;
}

/** Extract workflow-level concurrency block (first occurrence). */
export function extractConcurrencyBlock(src) {
  const m = src.match(/(?:^|\n)concurrency:\s*\n((?:[ \t]+.+\n)+)/);
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

/** Detect whether NDIC group is a static shared writer lock (forbidden for whole workflow). */
export function isStaticSharedWriterGroup(groupRaw) {
  return /^info-events-data-writers\s*$/.test(groupRaw);
}

export function hasModeAwareGroupExpression(groupRaw) {
  return (
    /inputs\.mode\s*==\s*'active'/.test(groupRaw) &&
    groupRaw.includes(PRODUCTION_ACTIVATION_GROUP) &&
    groupRaw.includes(NDIC_STAGING_GROUP)
  );
}

/** Simulate pending-replacement semantics (GitHub docs): at most 1 running + 1 pending. */
export function simulatePendingReplacement(state, incoming) {
  // state: { running: id|null, pending: id|null }
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

  const ndicConc = parseConcurrency(ndic);
  const chmiConc = parseConcurrency(chmi);
  const ieConc = parseConcurrency(ie);

  ok("ndic_concurrency_present", Boolean(ndicConc.block), "missing");
  ok("ndic_cancel_false", ndicConc.cancelInProgress === "false", ndicConc.cancelInProgress);
  ok("ndic_not_static_shared", !isStaticSharedWriterGroup(ndicConc.groupRaw), ndicConc.groupRaw);
  ok("ndic_mode_aware_group", hasModeAwareGroupExpression(ndicConc.groupRaw), ndicConc.groupRaw);
  ok("ndic_no_cancel_true", !/cancel-in-progress:\s*true/.test(ndicConc.block), "cancel-true");

  ok("chmi_shared_group", chmiConc.groupRaw === PRODUCTION_ACTIVATION_GROUP, chmiConc.groupRaw);
  ok("ie_shared_group", ieConc.groupRaw === PRODUCTION_ACTIVATION_GROUP, ieConc.groupRaw);
  ok("chmi_cancel_false", chmiConc.cancelInProgress === "false", chmiConc.cancelInProgress);
  ok("ie_cancel_false", ieConc.cancelInProgress === "false", ieConc.cancelInProgress);

  // Resolved groups by mode
  ok("mode_off_staging", resolveNdicConcurrencyGroup("off") === NDIC_STAGING_GROUP, "off");
  ok("mode_shadow_staging", resolveNdicConcurrencyGroup("shadow") === NDIC_STAGING_GROUP, "shadow");
  ok("mode_active_production", resolveNdicConcurrencyGroup("active") === PRODUCTION_ACTIVATION_GROUP, "active");
  ok("mode_empty_staging", resolveNdicConcurrencyGroup("") === NDIC_STAGING_GROUP, "empty");

  // Isolation: shadow NDIC and CHMI must not collide on group name
  ok(
    "shadow_ne_chmi_group",
    resolveNdicConcurrencyGroup("shadow") !== chmiConc.groupRaw,
    "collision"
  );
  ok(
    "active_eq_chmi_group",
    resolveNdicConcurrencyGroup("active") === chmiConc.groupRaw,
    "active-lock"
  );

  // Scenario: CHMI running + NDIC shadow pending + new CHMI → NDIC must NOT share group (no cancel)
  {
    const chmiGroup = PRODUCTION_ACTIVATION_GROUP;
    const ndicGroup = resolveNdicConcurrencyGroup("shadow");
    ok("scenario_groups_differ", chmiGroup !== ndicGroup, "same");
    // Separate group: NDIC shadow cannot be cancelled by CHMI arrival
    const ndicState = { running: null, pending: "ndic-shadow" };
    const afterChmi =
      ndicGroup === chmiGroup
        ? simulatePendingReplacement(ndicState, "chmi-new")
        : { ...ndicState, cancelled: [] };
    ok(
      "ndic_shadow_survives_chmi",
      afterChmi.pending === "ndic-shadow" && afterChmi.cancelled.length === 0,
      "killed"
    );
  }

  // Two NDIC staging runs: pending replacement within staging group only
  {
    const s0 = { running: "ndic-a", pending: null };
    const s1 = simulatePendingReplacement(s0, "ndic-b");
    ok("two_ndic_pending_slot", s1.running === "ndic-a" && s1.pending === "ndic-b", "slot");
    const s2 = simulatePendingReplacement(s1, "ndic-c");
    ok("two_ndic_replaces_pending", s2.pending === "ndic-c" && s2.cancelled.includes("ndic-b"), "repl");
  }

  // Shared production activation: active NDIC joins CHMI group
  {
    const s0 = { running: "chmi-run", pending: null };
    const s1 = simulatePendingReplacement(s0, "ndic-active");
    ok("active_ndic_pending_behind_chmi", s1.running === "chmi-run" && s1.pending === "ndic-active", "pend");
  }

  // Triggers / defaults remain fail-closed
  ok("ndic_dispatch_only", /workflow_dispatch\s*:/.test(ndic) && !/^\s*schedule\s*:/m.test(ndic), "sched");
  ok("ndic_no_push", !/^\s*push\s*:/m.test(ndic), "push");
  ok("ndic_default_off", /default:\s*off\b/.test(ndic), "def");
  ok("ndic_shadow_isolated_env", /IU_NDIC_SHADOW_ISOLATED:/.test(ndic), "isol");
  ok("ndic_commit_active_only", /if:\s*github\.event\.inputs\.mode == 'active'/.test(ndic), "commit");

  // No empty/dynamic-only group without fallback
  ok("group_not_empty_expr", !/group:\s*\$\{\{\s*\}\}/.test(ndic), "empty-expr");
  ok("group_has_literal_fallback", ndicConc.groupRaw.includes(NDIC_STAGING_GROUP), "fallback");

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
