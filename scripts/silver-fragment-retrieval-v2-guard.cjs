#!/usr/bin/env node
"use strict";

const shared = require("./silver-search-read-hardening-v2-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(eng, shared.FRAGMENT_REPLAY, shared.moneySeedCtx(), shared.evaluateCrossModuleSearchRead);
  const ok = shared.printGuardHeader("silver_fragment_retrieval_v2", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
