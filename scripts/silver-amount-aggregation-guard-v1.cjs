#!/usr/bin/env node
"use strict";

const shared = require("./silver-search-read-hardening-v1-shared.cjs");

const AGG_REPLAY = [
  { id: "AGG_001", input: "Kolik jsem dal Pepovi na zálohách?", expectRx: /1500/ },
  { id: "AGG_002", input: "Kolik jsem dal celkem na zálohách Pepovi a Frantovi?", expectRx: /2000/ },
  { id: "AGG_003", input: "Kolik jsem dal zálohu Pepovi?", expectRx: /1000.*500|1500/ }
];

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(eng, AGG_REPLAY, shared.moneySeedCtx(), shared.evaluateMoneyPerson);
  const ok = shared.printGuardHeader("silver_amount_aggregation_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
