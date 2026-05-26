#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-help-guidance-render-governance-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-runtime-render-consistency-guard-v1-report.json");

function main() {
  const eng = harness.loadEngine();
  const probe = shared.CRITICAL_HELP_PACK.slice(0, 12);
  const branches = {};
  let inconsistent = 0;
  for (let i = 0; i < probe.length; i++) {
    const input = probe[i];
    const sigs = {};
    for (let run = 0; run < 3; run++) {
      try {
        if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
      } catch (e0) {
        void e0;
      }
      const turn = eng.processUserTurn(input, eng.createEmptyDraft(), harness.ctxForCase("calendar_write"));
      const sig =
        String(turn.normalizedIntent || "") +
        "|" +
        String(turn.processingState || "") +
        "|" +
        (eng.iuSilverIsHelpGuidanceRenderModeV1(turn) ? "help" : "save");
      sigs[sig] = (sigs[sig] || 0) + 1;
    }
    const keys = Object.keys(sigs);
    if (keys.length > 1) inconsistent++;
    branches[input] = sigs;
  }
  const report = {
    harness_id: "silver_runtime_render_consistency_v1",
    main_commit: shared.mainCommit(),
    probe_count: probe.length,
    inconsistent_count: inconsistent,
    branches: branches,
    runtime_consistency_accuracy_pct: probe.length ? Math.round(((probe.length - inconsistent) / probe.length) * 1000) / 10 : 100
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
  console.log("=== SILVER_RUNTIME_RENDER_CONSISTENCY_V1 ===");
  console.log("probe_count=" + probe.length);
  console.log("inconsistent_count=" + inconsistent);
  console.log("runtime_consistency_accuracy_pct=" + report.runtime_consistency_accuracy_pct);
  console.log("PASS_FAIL=" + (inconsistent === 0 ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_RUNTIME_RENDER_CONSISTENCY_V1 ===");
  process.exit(inconsistent === 0 ? 0 : 1);
}

if (require.main === module) main();
