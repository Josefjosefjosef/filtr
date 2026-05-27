#!/usr/bin/env node
"use strict";

const shared = require("./silver-search-read-hardening-v1-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(
    eng,
    shared.CALENDAR_WRITE_NEGATED_TASK_REPLAY,
    shared.defaultCtx(),
    shared.evaluateCalendarWriteNegated
  );
  const ok = shared.printGuardHeader("silver_calendar_write_negated_task_target_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
