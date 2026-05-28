#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-long-session-firewall-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-long-session-drift-diagnostic-v2-report.json");

function main() {
  const cases = shared.buildCorpusV1(380);
  const res = shared.runAudit("silver_long_session_drift_diagnostic_v2", cases, REPORT, {
    diagnostic: true,
    corpus_size: cases.length
  });
  const cc = res.classCounts || {};
  console.log("=== SILVER_LONG_SESSION_DRIFT_DIAGNOSTIC_V2 ===");
  console.log("total=" + res.report.total);
  console.log("pass=" + res.report.pass);
  console.log("fail=" + res.report.fail);
  console.log("long_session_fail_count=" + res.report.fail);
  console.log("stale_context_count=" + (cc.STALE_CONTEXT_LEAK || 0));
  console.log("clarification_leak_count=" + (cc.CLARIFICATION_LEAK || 0));
  console.log("module_leak_count=" + (cc.MODULE_LEAK || 0));
  console.log("read_create_conflict_count=" + (cc.READ_CREATE_CONFLICT || 0));
  console.log("true_engine_fail_count=" + (cc.TRUE_ENGINE_FAIL || 0));
  console.log("harness_or_gold_count=" + (cc.HARNESS_OR_GOLD || 0));
  console.log("ownership_reset_needed=" + ((cc.STALE_CONTEXT_LEAK || 0) + (cc.CLARIFICATION_LEAK || 0)));
  console.log("query_after_failed_save_count=" + (shared.filterFamilies(cases, ["query_after_failed_save"]).length));
  console.log("query_after_timestamp_count=" + (shared.filterFamilies(cases, ["query_after_timestamp_render"]).length));
  console.log("read_to_create_leak_count=" + (res.report.read_to_create_leak_count || 0));
  console.log("PASS_FAIL=" + (res.report.fail === 0 ? "PASS" : "FAIL"));
  if (res.fails[0]) {
    console.log("first_fail_id=" + res.fails[0].id);
    console.log("first_fail_class=" + (res.fails[0].failClass || ""));
    console.log("first_fail_issues=" + (res.fails[0].issues || []).join(","));
  }
  console.log("=== END_SILVER_LONG_SESSION_DRIFT_DIAGNOSTIC_V2 ===");
  process.exit(res.report.fail === 0 ? 0 : 1);
}
if (require.main === module) main();
