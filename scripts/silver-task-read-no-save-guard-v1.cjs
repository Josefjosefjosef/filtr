#!/usr/bin/env node
"use strict";

const shared = require("./silver-search-read-hardening-v1-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(
    eng,
    shared.TASK_READ_NO_SAVE_REPLAY,
    shared.moneySeedCtx(),
    shared.evaluateReadNoSave
  );
  const ok = shared.printGuardHeader("silver_task_read_no_save_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
