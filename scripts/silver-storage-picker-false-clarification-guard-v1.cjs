#!/usr/bin/env node
"use strict";

const shared = require("./silver-cross-module-negation-target-v1-shared.cjs");

function evaluateNoPicker(c, turn) {
  const issues = shared.evaluateCrossModuleCase(c, turn);
  if (turn.processingState === "STORAGE_DISAMBIGUATION") issues.push("storage_picker");
  if (String(turn.normalizedIntent || "") === "create.storage_disambiguation") issues.push("storage_disambiguation");
  return issues;
}

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(
    eng,
    shared.STORAGE_PICKER_FALSE_CLARIFICATION_REPLAY,
    shared.defaultCtx(),
    evaluateNoPicker
  );
  const ok = shared.printGuardHeader("silver_storage_picker_false_clarification_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
