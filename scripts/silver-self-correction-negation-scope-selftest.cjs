#!/usr/bin/env node
/**
 * Regression: global no-write negation vs scoped update negation (Self-Correction harness).
 */
/* eslint-disable no-console */
const { foldCs } = require("./audit_silver_realistic_mobile_corpus.cjs");
const {
  isGlobalNoWriteNegation,
  isScopedUpdateNegation,
  countsAsSafetyNegationWriteLeak,
} = require("./silver-self-correction-negation-scope.cjs");

function fail(msg) {
  console.log("SELF_CORRECTION_NEGATION_SCOPE_SELFTEST=FAIL " + msg);
  process.exit(1);
}

const updateCalCase = {
  sc_lane: "correction_update_vs_create",
  cluster: "self_correction_update_cal",
  meta: { updateVsCreate: true, preferUpdate: true },
};

const noisyNegCase = {
  sc_lane: "noisy_mobile_self_correction",
  cluster: "self_correction_noisy_neg_read",
  group: "calendar_query",
};

let globalNeg = "PASS";
let scopedNeg = "PASS";
let trueLeak = "PASS";

const globalFold = foldCs("mrkni kalendář nic neukládej");
if (!isGlobalNoWriteNegation(globalFold)) {
  globalNeg = "FAIL";
}
if (!countsAsSafetyNegationWriteLeak(globalFold, { cluster: "self_correction_negation_readonly" })) {
  globalNeg = "FAIL";
}

const scopedFold = foldCs("Oprav událost schůzka na zítra, nevytvářej druhou schůzku.");
if (!isScopedUpdateNegation(scopedFold)) {
  scopedNeg = "FAIL";
}
if (countsAsSafetyNegationWriteLeak(scopedFold, updateCalCase)) {
  scopedNeg = "FAIL";
}

const noisyFold = foldCs("teda mrkni kalendář zitra nic neuklad ne vlastne jen schuzka zitra");
if (!countsAsSafetyNegationWriteLeak(noisyFold, noisyNegCase)) {
  trueLeak = "FAIL";
}
if (!isGlobalNoWriteNegation(noisyFold) && !/\bnic\s+neuklad/i.test(noisyFold)) {
  trueLeak = "FAIL";
}

if (globalNeg === "FAIL" || scopedNeg === "FAIL" || trueLeak === "FAIL") {
  fail(
    "global=" +
      globalNeg +
      " scoped=" +
      scopedNeg +
      " true_leak=" +
      trueLeak,
  );
}

console.log("=== SELF_CORRECTION_NEGATION_SCOPE_SELFTEST ===");
console.log("selftest_global_negation=" + globalNeg);
console.log("selftest_scoped_negation=" + scopedNeg);
console.log("selftest_true_leak_preserved=" + trueLeak);
console.log("SELF_CORRECTION_NEGATION_SCOPE_SELFTEST=PASS");
console.log("=== END_SELF_CORRECTION_NEGATION_SCOPE_SELFTEST ===");
