#!/usr/bin/env node
"use strict";

const shared = require("./silver-production-reality-v1-shared.cjs");

function main() {
  const res = shared.runProductionRealityRegression();
  const meta = res.meta || {};

  console.log("=== SILVER_PRODUCTION_REALITY_REGRESSION_V1 ===");
  console.log("current_main=" + meta.currentMain);
  console.log("production_app_js_commit=" + meta.productionAppJsCommit);
  console.log("production_app_js_current=" + meta.productionAppJsCommit);
  console.log("task_query_pass=" + res.task_query_pass);
  console.log("calendar_query_pass=" + res.calendar_query_pass);
  console.log("notes_query_pass=" + res.notes_query_pass);
  console.log("diacritics_pass=" + res.diacritics_pass);
  console.log("original_text_preservation_pass=" + res.original_text_preservation_pass);
  console.log("routing_regression_count=" + res.routing_regression_count);
  console.log("normalized_text_leak_count=" + res.normalized_text_leak_count);
  console.log("not_found_wrong_count=" + res.not_found_wrong_count);
  console.log("all_pass=" + res.all_pass);
  console.log("=== END_SILVER_PRODUCTION_REALITY_REGRESSION_V1 ===");

  if (!res.all_pass) {
    const all = []
      .concat(res.taskResults || [])
      .concat(res.calResults || [])
      .concat(res.noteResults || [])
      .concat(res.diaResults || []);
    for (let i = 0; i < all.length; i++) {
      if (!all[i].pass) {
        console.log("FAIL " + all[i].input + " :: " + (all[i].issues || []).join(","));
      }
    }
  }

  process.exit(res.all_pass ? 0 : 1);
}

if (require.main === module) main();
