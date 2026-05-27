#!/usr/bin/env node
"use strict";

const shared = require("./silver-search-read-hardening-v1-shared.cjs");

function evaluateNotFound(c, turn) {
  const issues = [];
  const msg = String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
  if (!/nenašel|nenasel|nic jsem/i.test(msg) && c.expectNotFound) issues.push("should_not_find");
  if (/nenašel|nenasel/i.test(msg) && !c.expectNotFound && c.expectRx && !c.expectRx.test(msg)) issues.push("false_negative");
  if (c.expectRx && !c.expectRx.test(msg)) issues.push("message_miss");
  return issues;
}

const NOT_FOUND_REPLAY = [
  { id: "NFT_001", input: "Kolik jsem dal Josefovi na zálohách?", expectNotFound: true },
  { id: "NFT_002", input: "Kolik jsem dal Frantovi zálohu?", expectRx: /500/, expectNotFound: false }
];

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(eng, NOT_FOUND_REPLAY, shared.moneySeedCtx(), evaluateNotFound);
  const ok = shared.printGuardHeader("silver_not_found_truthfulness_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
