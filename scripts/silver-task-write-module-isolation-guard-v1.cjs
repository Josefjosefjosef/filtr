#!/usr/bin/env node
"use strict";

const shared = require("./silver-task-write-hardening-v1-shared.cjs");

const MODULE_ISOLATION_REPLAY = shared.TASK_WRITE_OWNERSHIP_REPLAY.filter(function (c) {
  return c.family === "note_conflict" || c.family === "negation_safety";
});

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(eng, MODULE_ISOLATION_REPLAY, shared.defaultCtx(), shared.evaluateTaskWrite);
  const ok = shared.printGuardHeader("silver_task_write_module_isolation_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
