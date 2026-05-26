#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-help-guidance-render-governance-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-help-render-runtime-diagnostic-v1-report.json");

function main() {
  const eng = harness.loadEngine();
  const cases = shared.CRITICAL_HELP_PACK.map(function (input, i) {
    return { id: "HRD_" + String(i + 1).padStart(3, "0"), input: input };
  });
  const diag = shared.runRuntimeDiagnostic(eng, cases);
  const staleSources = [];
  const fallbackSources = [];
  for (let i = 0; i < diag.leaks.length; i++) {
    const L = diag.leaks[i];
    for (let j = 0; j < L.issues.length; j++) {
      if (L.issues[j].indexOf("draft_") === 0) staleSources.push({ input: L.input, issue: L.issues[j], branch: L.branch });
      if (L.issues[j].indexOf("save_processing") === 0) fallbackSources.push({ input: L.input, issue: L.issues[j], branch: L.branch });
    }
  }
  const report = {
    harness_id: "silver_help_render_runtime_diagnostic_v1",
    main_commit: shared.mainCommit(),
    cases_total: cases.length,
    render_branches: diag.branches,
    payload_shell_leaks: diag.leaks.length,
    stale_render_sources: staleSources,
    fallback_render_leaks: fallbackSources,
    continuation_leaks: diag.leaks.filter(function (x) {
      return x.issues.indexOf("storage_disambiguation_leak") >= 0;
    }),
    render_ownership: "iuSilverIsHelpGuidanceRenderModeV1 -> renderDraftCard text-only branch",
    PASS_FAIL: diag.leaks.length === 0 ? "PASS" : "FAIL"
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
  console.log("=== SILVER_HELP_RENDER_RUNTIME_DIAGNOSTIC_V1 ===");
  console.log("cases_total=" + report.cases_total);
  console.log("payload_shell_leaks=" + report.payload_shell_leaks);
  console.log("stale_render_leaks=" + staleSources.length);
  console.log("fallback_render_leaks=" + fallbackSources.length);
  console.log("continuation_leaks=" + report.continuation_leaks.length);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_SILVER_HELP_RENDER_RUNTIME_DIAGNOSTIC_V1 ===");
  process.exit(report.PASS_FAIL === "PASS" ? 0 : 1);
}

if (require.main === module) main();
