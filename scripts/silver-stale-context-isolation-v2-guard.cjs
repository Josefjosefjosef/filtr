#!/usr/bin/env node
"use strict";

const shared = require("./silver-search-read-hardening-v2-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(eng, shared.STALE_CONTEXT_REPLAY, shared.moneySeedCtx(), shared.evaluateReadNoSave);
  const ok = shared.printGuardHeader("silver_stale_context_isolation_v2", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
