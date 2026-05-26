#!/usr/bin/env node
/**
 * silver-multi-intent-20k-regression-guard.cjs
 * Permanent guard: multi_intent slice must stay 2000/2000.
 */
"use strict";

const { run20kSliceGuard } = require("./silver-20k-regression-guard-shared.cjs");

const TARGET = 2000;
const GROUP = "multi_intent";

function main() {
  const r = run20kSliceGuard(GROUP, TARGET);
  console.log("=== SILVER_MULTI_INTENT_20K_REGRESSION_GUARD ===");
  console.log("guard_id=silver_multi_intent_20k_regression_guard_v1");
  console.log("group=" + GROUP);
  console.log("target=" + TARGET + "/" + TARGET);
  console.log("pass=" + r.pass + "/" + r.total);
  console.log("before_target=" + TARGET);
  console.log("after_target=" + TARGET);
  if (r.firstFail) {
    console.log("first_fail_input=" + r.firstFail.input);
    console.log("first_fail_expected=" + r.firstFail.expected);
    console.log("first_fail_actual=" + r.firstFail.actual);
    console.log("first_fail_route=" + r.firstFail.route);
    console.log("first_fail_reason=" + r.firstFail.reason);
    console.log("first_fail_group=" + r.firstFail.group);
  } else {
    console.log("first_fail=(none)");
  }
  console.log("PASS_FAIL=" + r.PASS_FAIL);
  console.log("=== END_SILVER_MULTI_INTENT_20K_REGRESSION_GUARD ===");
  process.exit(r.ok ? 0 : 1);
}

if (require.main === module) main();
