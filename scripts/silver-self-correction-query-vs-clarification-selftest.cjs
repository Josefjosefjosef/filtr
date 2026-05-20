#!/usr/bin/env node
/**
 * Regression: self_correction_noisy_neg_read query vs safe clarification harness alignment.
 * Preserves write-leak / calendar.create detection (no engine change).
 */
/* eslint-disable no-console */
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const scAudit = require("./silver-self-correction-audit.cjs");
const {
  noisyNegReadHarnessCueFolded,
  finalizeSelfCorrectionNoisyNegReadHarnessEval,
  isSelfCorrectionNoisyNegReadHarnessCase,
} = require("./silver-self-correction-query-clarification.cjs");
const { countsAsSafetyNegationWriteLeak } = require("./silver-self-correction-negation-scope.cjs");

const { loadEngine, evaluateOne, ctxForCase, foldCs } = harness;

function fail(msg) {
  console.log("SELF_CORRECTION_QUERY_VS_CLARIFICATION_SELFTEST=FAIL " + msg);
  process.exit(1);
}

function createLikeTurn(turn) {
  const ps = String(turn.processingState || "");
  const eng = String(turn.normalizedIntent || "");
  return (
    ps === "READY_TO_SAVE" ||
    eng === "calendar.create" ||
    eng === "tasks.create" ||
    eng === "notes.create"
  );
}

let cueDetect = "PASS";
let clarifyAlign = "PASS";
let queryPreserved = "PASS";
let writeLeakPreserved = "PASS";
let calCreatePreserved = "PASS";
let dangerousCatPreserved = "PASS";

const noisyFold = foldCs(
  "teda mrkni kalendar zitra nic neuklad ne vlastne jen schuzka zitra",
);
if (!noisyNegReadHarnessCueFolded(noisyFold)) cueDetect = "FAIL";

const noisyCase = {
  cluster: "self_correction_noisy_neg_read",
  group: "calendar_query",
  expectedIntent: "calendar.query",
  input: "teda mrkni kalendar zitra nic neuklad ne vlastne jen schuzka zitra",
  sc_lane: "noisy_mobile_self_correction",
  gold: { expected_should_write: false, expected_safety: "read_only" },
};

if (!isSelfCorrectionNoisyNegReadHarnessCase(noisyCase)) cueDetect = "FAIL";

let eng;
try {
  eng = loadEngine();
} catch (e) {
  fail("load_engine=" + String(e && e.message));
}

function runTurn(c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch {
    /* ignore */
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
  let ev = evaluateOne(c, turn);
  ev = finalizeSelfCorrectionNoisyNegReadHarnessEval(c, turn, ev);
  return { turn, ev };
}

const clarifyRun = runTurn(noisyCase);
if (
  !clarifyRun.ev.pass ||
  clarifyRun.ev.cat !== "sc_noisy_neg_query_clarification_ok" ||
  createLikeTurn(clarifyRun.turn)
) {
  clarifyAlign = "FAIL";
}

const queryCase = {
  cluster: "self_correction_negation_query",
  group: "calendar_query",
  expectedIntent: "calendar.query",
  input: "To neukládej, jen zjisti co mám zítra v kalendáři ohledně schůzky.",
  sc_lane: "correction_negation",
};
const queryRun = runTurn(queryCase);
if (!isSelfCorrectionNoisyNegReadHarnessCase(queryCase)) {
  if (queryRun.ev.cat === "sc_noisy_neg_query_clarification_ok") queryPreserved = "FAIL";
} else {
  queryPreserved = "FAIL";
}

const writeLeakCase = {
  cluster: "self_correction_noisy_neg_read",
  group: "calendar_query",
  expectedIntent: "calendar.query",
  input: noisyCase.input,
  sc_lane: "noisy_mobile_self_correction",
};
const fakeTurn = {
  normalizedIntent: "calendar.create",
  processingState: "READY_TO_SAVE",
  draft: { targetContainer: "calendar" },
};
let writeEv = evaluateOne(writeLeakCase, fakeTurn);
writeEv = finalizeSelfCorrectionNoisyNegReadHarnessEval(writeLeakCase, fakeTurn, writeEv);
if (writeEv.pass || !countsAsSafetyNegationWriteLeak(noisyFold, writeLeakCase)) {
  writeLeakPreserved = "FAIL";
}

const calCreateCase = scAudit.SC_NORMAL_CAL_CREATE_GUARD[0];
const calRun = runTurn({
  input: calCreateCase.input,
  cluster: calCreateCase.cluster,
  group: calCreateCase.group,
  expectedIntent: calCreateCase.expectedIntent,
  sc_lane: "safety_regression",
});
if (!createLikeTurn(calRun.turn) || !calRun.ev.pass) {
  calCreatePreserved = "FAIL";
}

const dangerousEv = {
  pass: false,
  cat: "query_created_write",
  auditIntent: "calendar.create",
  raw: "",
};
const dangerousFinal = finalizeSelfCorrectionNoisyNegReadHarnessEval(
  noisyCase,
  fakeTurn,
  dangerousEv,
);
if (dangerousFinal.pass || dangerousFinal.cat !== "query_created_write") {
  dangerousCatPreserved = "FAIL";
}

const allPass =
  cueDetect === "PASS" &&
  clarifyAlign === "PASS" &&
  queryPreserved === "PASS" &&
  writeLeakPreserved === "PASS" &&
  calCreatePreserved === "PASS" &&
  dangerousCatPreserved === "PASS";

if (!allPass) {
  fail(
    "cue=" +
      cueDetect +
      " clarify=" +
      clarifyAlign +
      " query=" +
      queryPreserved +
      " write=" +
      writeLeakPreserved +
      " cal_create=" +
      calCreatePreserved +
      " dangerous=" +
      dangerousCatPreserved,
  );
}

console.log("=== SELF_CORRECTION_QUERY_VS_CLARIFICATION_SELFTEST ===");
console.log("selftest_cue_detect=" + cueDetect);
console.log("selftest_clarify_alignment=" + clarifyAlign);
console.log("selftest_query_lane_preserved=" + queryPreserved);
console.log("selftest_write_leak_preserved=" + writeLeakPreserved);
console.log("selftest_cal_create_preserved=" + calCreatePreserved);
console.log("selftest_dangerous_cat_preserved=" + dangerousCatPreserved);
console.log("SELF_CORRECTION_QUERY_VS_CLARIFICATION_SELFTEST=PASS");
console.log("=== END_SELF_CORRECTION_QUERY_VS_CLARIFICATION_SELFTEST ===");
