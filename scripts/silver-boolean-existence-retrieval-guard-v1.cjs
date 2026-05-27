#!/usr/bin/env node
"use strict";

const shared = require("./silver-search-read-hardening-v1-shared.cjs");

const BOOL_REPLAY = [
  { id: "BER_001", input: "Dal jsem nějaké zálohy Frantovi?", expectRx: /ano|500/i },
  { id: "BER_002", input: "Dával jsem Pepovi nějakou zálohu?", expectRx: /ano|1500|1000/i },
  { id: "BER_003", input: "Najdi mi v poznámkách jestli jsem dával Pepovi nějakou zálohu.", expectRx: /ano|1500|1000/i }
];

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(eng, BOOL_REPLAY, shared.moneySeedCtx(), shared.evaluateMoneyPerson);
  const ok = shared.printGuardHeader("silver_boolean_existence_retrieval_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
