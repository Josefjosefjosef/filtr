#!/usr/bin/env node
"use strict";

const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-help-guidance-render-governance-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-save-shell-suppression-guard-v1-report.json");

function main() {
  const eng = harness.loadEngine();
  const cases = shared.CRITICAL_HELP_PACK;
  let leaks = 0;
  const detail = [];
  for (let i = 0; i < cases.length; i++) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(cases[i], eng.createEmptyDraft(), harness.ctxForCase("calendar_write"));
    const issues = shared.turnWouldLeakSaveShell(turn, eng);
    if (issues.length) {
      leaks++;
      detail.push({ input: cases[i], issues: issues });
    }
  }
  const fs = require("fs");
  const report = {
    harness_id: "silver_save_shell_suppression_v1",
    main_commit: shared.mainCommit(),
    cases_total: cases.length,
    save_shell_leaks: leaks,
    fails: detail
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
  console.log("=== SILVER_SAVE_SHELL_SUPPRESSION_V1 ===");
  console.log("cases_total=" + cases.length);
  console.log("save_shell_leaks=" + leaks);
  console.log("PASS_FAIL=" + (leaks === 0 ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_SAVE_SHELL_SUPPRESSION_V1 ===");
  process.exit(leaks === 0 ? 0 : 1);
}

if (require.main === module) main();
