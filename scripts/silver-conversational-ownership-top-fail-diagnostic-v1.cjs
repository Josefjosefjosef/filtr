#!/usr/bin/env node
"use strict";
const path = require("path");
const fs = require("fs");
const shared = require("./silver-conversational-ownership-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-conversational-ownership-top-fail-report.json");

function clusterKey(f) {
  return String(f.family || "") + "|" + String(f.failClass || "") + "|" + (f.issues || []).join(";");
}

function recommendFixScope(failClass, fail) {
  if (failClass === "HARNESS_OR_GOLD") return "harness_or_gold_review";
  if (failClass === "AMBIGUOUS_INPUT" || failClass === "FIREWALL_OVERBLOCK") return "safe_clarification_only";
  if (failClass === "TRUE_ENGINE_FAIL" || failClass === "CONVERSATIONAL_DRIFT" || failClass === "SAVE_QUERY_CONTAMINATION") {
    if (/\bmodule_leak\b/.test((fail.issues || []).join(","))) return "narrow_continuation_ownership_routing";
    return "narrow_engine_ownership_fix";
  }
  return "diagnostic_review";
}

function main() {
  const cases = shared.buildCorpusV1(700);
  const res = shared.runAudit("silver_conversational_ownership_top_fail_diagnostic_v1", cases, REPORT, {
    diagnostic: true,
    top_fail_only: true
  });
  const cc = res.classCounts || {};
  const fails = res.fails || [];
  const clusters = {};
  for (let i = 0; i < fails.length; i++) {
    const k = clusterKey(fails[i]);
    clusters[k] = (clusters[k] || 0) + 1;
  }
  let topCluster = "";
  let topCount = 0;
  for (const k in clusters) {
    if (clusters[k] > topCount) {
      topCount = clusters[k];
      topCluster = k;
    }
  }
  const topFail = fails[0] || null;
  const failClass = topFail ? topFail.failClass || "TRUE_ENGINE_FAIL" : "";
  const rootCause =
    topFail && failClass === "CONVERSATIONAL_DRIFT" && /\bmodule_leak:tasks\.create\b/.test((topFail.issues || []).join(","))
      ? "continuation_calendar_note_write_routes_to_tasks_instead_of_notes_or_calendar"
      : topFail
        ? failClass.toLowerCase() + ":" + (topFail.family || "")
        : "none";
  const safeToFix =
    failClass === "HARNESS_OR_GOLD" || failClass === "AMBIGUOUS_INPUT"
      ? "NO"
      : failClass === "TRUE_ENGINE_FAIL" || failClass === "CONVERSATIONAL_DRIFT" || failClass === "SAVE_QUERY_CONTAMINATION"
        ? "YES"
        : "REVIEW";
  const summary = {
    total_cases: res.report.total,
    fail_count: res.report.fail,
    true_engine_fail: cc.TRUE_ENGINE_FAIL || 0,
    harness_problem: cc.HARNESS_OR_GOLD || 0,
    safe_clarification: (cc.AMBIGUOUS_INPUT || 0) + (cc.FIREWALL_OVERBLOCK || 0),
    template_problem: cc.TEMPLATE_DNA || 0,
    top_cluster: topCluster,
    root_cause: rootCause,
    safe_to_fix: safeToFix,
    recommended_fix_scope: topFail ? recommendFixScope(failClass, topFail) : "none",
    top_fail: topFail,
    fail_classification: cc,
    clusters: clusters
  };
  fs.writeFileSync(REPORT, JSON.stringify(summary, null, 2), "utf8");
  console.log("=== SILVER_CONVERSATIONAL_OWNERSHIP_TOP_FAIL ===");
  console.log("total_cases=" + summary.total_cases);
  console.log("fail_count=" + summary.fail_count);
  console.log("true_engine_fail=" + summary.true_engine_fail);
  console.log("harness_problem=" + summary.harness_problem);
  console.log("safe_clarification=" + summary.safe_clarification);
  console.log("template_problem=" + summary.template_problem);
  console.log("top_cluster=" + summary.top_cluster);
  console.log("root_cause=" + summary.root_cause);
  console.log("safe_to_fix=" + summary.safe_to_fix);
  console.log("recommended_fix_scope=" + summary.recommended_fix_scope);
  if (topFail) {
    console.log("top_fail_id=" + topFail.id);
    console.log("top_fail_family=" + topFail.family);
    console.log("top_fail_input=" + topFail.input);
    console.log("top_fail_class=" + failClass);
    console.log("top_fail_issues=" + (topFail.issues || []).join(","));
    console.log("top_fail_intent=" + (topFail.intent || ""));
  }
  console.log("=== END_SILVER_CONVERSATIONAL_OWNERSHIP_TOP_FAIL ===");
  process.exit(summary.fail_count === 0 ? 0 : 1);
}
if (require.main === module) main();
