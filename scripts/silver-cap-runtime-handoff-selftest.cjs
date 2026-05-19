#!/usr/bin/env node
/**
 * Orchestration-only: CAP runtime label + audit registry handoff selftest.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const {
  gitHead,
  resolveCapRuntimeHandoff,
  buildAuditRegistry,
  prioritizeTrueEngineFail,
} = require("./silver-audit-registry.cjs");
const { pickClusterFromAuditRegistry, pickTopClusterDiagnostic } = require("./silver-next-action-planner-handoff.cjs");

function fail(msg) {
  console.log("SILVER_CAP_RUNTIME_HANDOFF_SELFTEST=FAIL " + msg);
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, "..");
const head = gitHead(repoRoot);
if (!head || head.length < 7) {
  fail("gitHead_empty_on_windows");
}

const reg = buildAuditRegistry(repoRoot);
const pub = reg.audits.find((a) => a.audit_id === "public_ux");
if (!pub) {
  fail("missing_public_ux_audit");
}
if (pub.last_commit && head !== pub.last_commit && pub.stale !== "YES") {
  fail("commit_mismatch_must_mark_stale got_stale=" + pub.stale);
}

const pri = prioritizeTrueEngineFail(reg);
const rcz2StaleRow = pri.find((r) => r.cluster === "rcz2_retrieval" && r.fail_count >= 500);
if (rcz2StaleRow) {
  fail("stale_rcz2_retrieval_still_in_prioritizer_fail=" + rcz2StaleRow.fail_count);
}
const freshPasses = reg.fresh_authoritative_passes || [];
const rcz2Pass = freshPasses.find((fp) => fp.cluster === "rcz2_retrieval");
if (!rcz2Pass) {
  fail("missing_fresh_authoritative_rcz2_pass");
}

const handoff = resolveCapRuntimeHandoff(repoRoot, { max_autonomous_hard_cycles: 15 });
if (!handoff.cap_label || !/^CAP\d+$/.test(handoff.cap_label)) {
  fail("invalid_cap_label=" + handoff.cap_label);
}
if (handoff.cap_label === "CAP50") {
  fail("cap_label_still_cap50");
}
if (!handoff.cluster_diag || !handoff.cluster_diag.cluster) {
  fail("cluster_diag_missing");
}
if (handoff.cluster_diag.cluster === "rcz2_retrieval") {
  fail("cluster_diag_still_stale_rcz2_retrieval");
}

const diag = pickTopClusterDiagnostic();
if (!diag || !diag.cluster) {
  fail("pickTopCluster_missing");
}
if (diag.cluster === "rcz2_retrieval") {
  fail("pickTopCluster_still_stale_rcz2");
}
if (String(diag.source || "").indexOf("silver-audit-registry") < 0) {
  fail("pickTopCluster_not_from_registry");
}

if (handoff.cap_label !== "CAP15") {
  fail("resolveCapRuntimeHandoff_cap_label_expected_CAP15_got=" + handoff.cap_label);
}

console.log("=== SILVER_CAP_RUNTIME_HANDOFF_SELFTEST ===");
console.log("SILVER_CAP_RUNTIME_HANDOFF_SELFTEST=PASS");
console.log("git_head=" + head);
console.log("public_ux_stale=" + pub.stale);
console.log("cap_label=" + handoff.cap_label);
console.log("registry_cluster=" + handoff.cluster_diag.cluster);
console.log("harness_command=" + handoff.cluster_diag.harness_command);
console.log("prioritizer_rows=" + pri.length);
console.log("=== END_SILVER_CAP_RUNTIME_HANDOFF_SELFTEST ===");
process.exit(0);
