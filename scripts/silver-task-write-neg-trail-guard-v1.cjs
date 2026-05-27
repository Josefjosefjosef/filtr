#!/usr/bin/env node
"use strict";

const shared = require("./silver-cross-module-negation-target-v1-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(
    eng,
    shared.TASK_WRITE_NEG_TRAIL_REPLAY,
    shared.defaultCtx(),
    shared.evaluateTaskWrite
  );
  const ok = shared.printGuardHeader("silver_task_write_neg_trail_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
