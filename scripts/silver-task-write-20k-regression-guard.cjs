#!/usr/bin/env node
/**
 * silver-task-write-20k-regression-guard.cjs
 * Permanent guard: task_write slice must stay 3000/3000.
 */
"use strict";

const { run20kSliceGuard } = require("./silver-20k-regression-guard-shared.cjs");

const TARGET = 3000;
const GROUP = "task_write";

function main() {
  const r = run20kSliceGuard(GROUP, TARGET);
  console.log("=== SILVER_TASK_WRITE_20K_REGRESSION_GUARD ===");
  console.log("guard_id=silver_task_write_20k_regression_guard_v1");
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
  } else {
    console.log("first_fail=(none)");
  }
  console.log("query_created_write_count=" + (r.safety.query_created_write_count || 0));
  console.log("write_when_negated_count=" + (r.safety.write_when_negated_count || 0));
  console.log("PASS_FAIL=" + r.PASS_FAIL);
  console.log("=== END_SILVER_TASK_WRITE_20K_REGRESSION_GUARD ===");
  process.exit(r.ok ? 0 : 1);
}

if (require.main === module) main();
