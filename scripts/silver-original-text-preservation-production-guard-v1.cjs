#!/usr/bin/env node
"use strict";

const shared = require("./silver-production-reality-v1-shared.cjs");

function main() {
  const eng = require("./silver-20k-regression-guard-shared.cjs").loadEngine();
  const ctx = shared.buildProductionCtx();
  let leak = 0;
  for (let i = 0; i < shared.DIACRITICS_QUERIES.length; i++) {
    const q = shared.DIACRITICS_QUERIES[i];
    const r = shared.evaluateQuery(eng, ctx, q, "notes.read");
    if (shared.hasNormalizedTextLeak(r.msg)) leak++;
    if (/Nic jsem k tomu nena[sš]el/i.test(r.msg)) leak++;
    if (q.indexOf("Tomáš") >= 0 && !/Tomáš|květen/i.test(r.msg)) leak++;
    if (q.indexOf("stůl") >= 0 && !/stůl/i.test(r.msg)) leak++;
  }
  console.log("=== SILVER_ORIGINAL_TEXT_PRESERVATION_PRODUCTION_GUARD_V1 ===");
  console.log("cases=" + shared.DIACRITICS_QUERIES.length);
  console.log("normalized_text_leak_count=" + leak);
  console.log("PASS_FAIL=" + (leak === 0 ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_ORIGINAL_TEXT_PRESERVATION_PRODUCTION_GUARD_V1 ===");
  process.exit(leak === 0 ? 0 : 1);
}

if (require.main === module) main();
