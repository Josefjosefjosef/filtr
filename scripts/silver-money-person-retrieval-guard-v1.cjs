#!/usr/bin/env node
"use strict";

const shared = require("./silver-search-read-hardening-v1-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(
    eng,
    shared.MONEY_PERSON_REPLAY,
    shared.moneySeedCtx(),
    shared.evaluateMoneyPerson
  );
  const ok = shared.printGuardHeader("silver_money_person_retrieval_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
