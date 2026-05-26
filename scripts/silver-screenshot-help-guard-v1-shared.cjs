#!/usr/bin/env node
"use strict";

const shared = require("./silver-help-guidance-render-governance-v1-shared.cjs");

function buildCriticalCases(packName, inputs) {
  const out = [];
  for (let i = 0; i < inputs.length; i++) {
    out.push({ id: "CRIT_" + packName + "_" + String(i + 1).padStart(2, "0"), input: inputs[i], critical: true });
  }
  return out;
}

function runScreenshotHelpGuardV1(opts) {
  const o = opts || {};
  const criticalInputs = o.criticalInputs || [];
  const corpusCases = o.corpusCases || [];
  const harnessId = o.harnessId || "silver_screenshot_help_guard_v1";
  const reportPath = o.reportPath;
  const minPct = o.minPct != null ? o.minPct : 99;
  const extra = o.extra || {};

  const criticalCases = buildCriticalCases(o.packName || "pack", criticalInputs);
  const critRes = shared.runHelpGovernanceAudit(harnessId + "_critical", criticalCases, reportPath.replace(/\.json$/, "-critical-report.json"), extra);
  const corpusRes = shared.runHelpGovernanceAudit(harnessId, corpusCases, reportPath, Object.assign({}, extra, { corpus_cases: corpusCases.length }));

  const criticalOk = critRes.report.pass_count === critRes.report.cases_total;
  const corpusOk =
    corpusRes.report.accuracy_pct >= minPct &&
    corpusRes.report.save_shell_leaks === 0 &&
    corpusRes.report.draft_card_leaks === 0;
  const ok = criticalOk && corpusOk;

  return {
    ok: ok,
    critical: critRes.report,
    corpus: corpusRes.report,
    report: {
      harness_id: harnessId,
      critical_cases_total: critRes.report.cases_total,
      critical_pass_count: critRes.report.pass_count,
      critical_pass: criticalOk ? "PASS" : "FAIL",
      cases_total: corpusRes.report.cases_total,
      pass_count: corpusRes.report.pass_count,
      fail_count: corpusRes.report.fail_count,
      accuracy_pct: corpusRes.report.accuracy_pct,
      save_shell_leaks: corpusRes.report.save_shell_leaks,
      false_clarification_count: corpusRes.report.false_clarification_count,
      draft_card_leaks: corpusRes.report.draft_card_leaks,
      min_pass_pct: minPct,
      PASS_FAIL: ok ? "PASS" : "FAIL"
    }
  };
}

function printScreenshotHelpGuardHeader(harnessId, rep) {
  console.log("=== " + harnessId.toUpperCase() + " ===");
  console.log("critical_cases_total=" + rep.critical_cases_total);
  console.log("critical_pass_count=" + rep.critical_pass_count);
  console.log("critical_pass=" + rep.critical_pass);
  console.log("cases_total=" + rep.cases_total);
  console.log("pass_count=" + rep.pass_count);
  console.log("fail_count=" + rep.fail_count);
  console.log("accuracy_pct=" + rep.accuracy_pct);
  console.log("save_shell_leaks=" + rep.save_shell_leaks);
  console.log("false_clarification_count=" + rep.false_clarification_count);
  console.log("draft_card_leaks=" + rep.draft_card_leaks);
  console.log("PASS_FAIL=" + rep.PASS_FAIL);
  console.log("=== END_" + harnessId.toUpperCase() + " ===");
}

module.exports = {
  buildCriticalCases,
  runScreenshotHelpGuardV1,
  printScreenshotHelpGuardHeader
};
