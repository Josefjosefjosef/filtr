#!/usr/bin/env node
"use strict";

const shared = require("./silver-task-write-hardening-v1-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(eng, shared.TASK_WRITE_NEGATED_CAL_REPLAY, shared.defaultCtx(), shared.evaluateTaskWrite);
  const ok = shared.printGuardHeader("silver_task_write_negated_calendar_target_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
