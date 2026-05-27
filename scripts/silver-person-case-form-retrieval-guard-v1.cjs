#!/usr/bin/env node
"use strict";

const shared = require("./silver-search-read-hardening-v1-shared.cjs");

const CASE_REPLAY = [
  { id: "PCF_001", input: "Kolik jsem dal Pepovi na zálohách?", expectRx: /1500/ },
  { id: "PCF_002", input: "Kolik jsem dal Pepu zálohu?", expectRx: /1500|1000|500/ },
  { id: "PCF_003", input: "Kolik jsem dal Frantovi zálohu?", expectRx: /500/ },
  { id: "PCF_004", input: "Kolik jsem dal Frantou na zálohách?", expectRx: /500/ }
];

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(eng, CASE_REPLAY, shared.moneySeedCtx(), shared.evaluateMoneyPerson);
  const ok = shared.printGuardHeader("silver_person_case_form_retrieval_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
