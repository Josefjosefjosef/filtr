#!/usr/bin/env node
"use strict";

const shared = require("./silver-production-reality-v1-shared.cjs");

function main() {
  const eng = require("./silver-20k-regression-guard-shared.cjs").loadEngine();
  const ctx = shared.buildProductionCtx();
  let pass = 0;
  let fail = 0;
  for (let i = 0; i < shared.TASK_QUERIES.length; i++) {
    const r = shared.evaluateQuery(eng, ctx, shared.TASK_QUERIES[i], "tasks.read");
    if (r.pass) pass++;
    else fail++;
  }
  console.log("=== SILVER_TASK_QUERY_PRODUCTION_FAMILY_GUARD_V1 ===");
  console.log("cases=" + shared.TASK_QUERIES.length);
  console.log("pass=" + pass);
  console.log("fail=" + fail);
  console.log("PASS_FAIL=" + (fail === 0 ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_TASK_QUERY_PRODUCTION_FAMILY_GUARD_V1 ===");
  process.exit(fail === 0 ? 0 : 1);
}

if (require.main === module) main();
