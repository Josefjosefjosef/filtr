#!/usr/bin/env node
"use strict";

const shared = require("./silver-search-read-hardening-v1-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(
    eng,
    [{ id: "MPA_001", input: "Kolik jsem dal celkem na zálohách Pepovi a Frantovi?", expectRx: /2000|Pepovi.*1500/i }],
    shared.moneySeedCtx(),
    shared.evaluateMoneyPerson
  );
  const ok = shared.printGuardHeader("silver_multi_person_aggregation_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
