#!/usr/bin/env node
/** Negative + positive gates for Silver layout CLS dual-metric policy. */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { evaluateSilverLayoutClsGate, CLS_CAP } = require("./proof_silver_layout_guard.cjs");

const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

function gate(load, interaction, expectPass, id) {
  const r = evaluateSilverLayoutClsGate(load, interaction, CLS_CAP);
  must(r.cls_pass === expectPass, id + ":pass");
  if (expectPass === false && load > CLS_CAP) must(!r.cls_from_load_pass, id + ":load_fail");
  if (expectPass === false && interaction > CLS_CAP) must(!r.cls_interaction_pass, id + ":interaction_fail");
}

gate(0.03, 0, true, "both_under_cap");
gate(0.05, 0, true, "load_at_cap");
gate(0.05022, 0, false, "load_over_cap_gha_repro");
gate(0.03, 0.06, false, "interaction_over_cap");
gate(0.06, 0.03, false, "load_over_cap_interaction_ok");
gate(0, 0, true, "zero_reset_does_not_hide_load_if_load_tracked_separately");

must(
  evaluateSilverLayoutClsGate(0.036, 0, CLS_CAP).cls_from_load_pass &&
    evaluateSilverLayoutClsGate(0.036, 0, CLS_CAP).cls_interaction_pass,
  "local_main_baseline_sim"
);

console.log("IU_SILVER_LAYOUT_CLS_GUARD_SELFTEST_PASS=" + (fails.length === 0));
if (fails.length) {
  console.log("IU_SILVER_LAYOUT_CLS_GUARD_SELFTEST_FAILS=" + fails.join(","));
  process.exitCode = 1;
}
