#!/usr/bin/env node
/**
 * Regression: self_correction_safety_cal_readonly harness alignment (scripts only).
 * Preserves calendar.create leak / dangerous_write detection (no engine change).
 */
/* eslint-disable no-console */
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const scAudit = require("./silver-self-correction-audit.cjs");
const {
  safetyCalReadonlyHarnessCueFolded,
  finalizeSelfCorrectionSafetyCalReadonlyHarnessEval,
  isSelfCorrectionSafetyCalReadonlyHarnessCase,
} = require("./silver-self-correction-query-clarification.cjs");
const { countsAsSafetyNegationWriteLeak } = require("./silver-self-correction-negation-scope.cjs");

const { loadEngine, evaluateOne, ctxForCase, foldCs } = harness;

function fail(msg) {
  console.log("SELF_CORRECTION_SAFETY_CAL_READONLY_SELFTEST=FAIL " + msg);
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

let readEquiv = "PASS";
let queryEquiv = "PASS";
let clarifyEquiv = "PASS";
let writeLeakPreserved = "PASS";
let calCreatePreserved = "PASS";
let readonlyProtection = "PASS";

const calFold = foldCs("Mrkni prosím do kalendáře na schůzku, nic neukládej.");
if (!safetyCalReadonlyHarnessCueFolded(calFold)) {
  fail("cue_detect");
}

const safetyCase = {
  cluster: "self_correction_safety_cal_readonly",
  group: "calendar_query",
  expectedIntent: "calendar.query",
  input: "Mrkni prosím do kalendáře na schůzku, nic neukládej.",
  sc_lane: "safety_regression",
  gold: { expected_should_write: false, expected_safety: "read_only" },
};

if (!isSelfCorrectionSafetyCalReadonlyHarnessCase(safetyCase)) {
  fail("case_detect");
}

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
  ev = finalizeSelfCorrectionSafetyCalReadonlyHarnessEval(c, turn, ev);
  return { turn, ev };
}

const liveRun = runTurn(safetyCase);
const engLive = String(liveRun.turn.normalizedIntent || "");
if (createLikeTurn(liveRun.turn)) {
  writeLeakPreserved = "FAIL";
  readonlyProtection = "FAIL";
} else if (engLive === "calendar.read") {
  if (!liveRun.ev.pass) {
    readEquiv = "FAIL";
  }
} else if (engLive === "calendar.query") {
  if (!liveRun.ev.pass) {
    queryEquiv = "FAIL";
  }
} else if (engLive === "clarification" || engLive === "unknown") {
  if (!liveRun.ev.pass) {
    clarifyEquiv = "FAIL";
  }
} else {
  readEquiv = "FAIL";
  queryEquiv = "FAIL";
  clarifyEquiv = "FAIL";
}

function finalizeHarnessIntentFail(c, turn, auditIntent) {
  const baseEv = {
    pass: false,
    cat: "intent_fail",
    auditIntent,
    raw: "harness_probe",
  };
  return finalizeSelfCorrectionSafetyCalReadonlyHarnessEval(c, turn, baseEv);
}

const readSynthetic = {
  normalizedIntent: "calendar.read",
  processingState: "",
  draft: {},
};
const readEv = finalizeHarnessIntentFail(safetyCase, readSynthetic, "calendar.read");
if (!readEv.pass || readEv.cat !== "sc_safety_cal_readonly_harness_ok") {
  readEquiv = "FAIL";
}

const querySynthetic = {
  normalizedIntent: "calendar.query",
  processingState: "",
  draft: {},
};
const queryEv = finalizeHarnessIntentFail(safetyCase, querySynthetic, "calendar.query");
if (!queryEv.pass || queryEv.cat !== "sc_safety_cal_readonly_harness_ok") {
  queryEquiv = "FAIL";
}

const clarifySynthetic = {
  normalizedIntent: "clarification",
  processingState: "",
  draft: {},
};
const clarifyEv = finalizeHarnessIntentFail(safetyCase, clarifySynthetic, "clarification");
if (!clarifyEv.pass || clarifyEv.cat !== "sc_safety_cal_readonly_harness_ok") {
  clarifyEquiv = "FAIL";
}

const fakeCreate = {
  normalizedIntent: "calendar.create",
  processingState: "READY_TO_SAVE",
  draft: { targetContainer: "calendar" },
};
let createEv = evaluateOne(safetyCase, fakeCreate);
createEv = finalizeSelfCorrectionSafetyCalReadonlyHarnessEval(safetyCase, fakeCreate, createEv);
if (createEv.pass || !countsAsSafetyNegationWriteLeak(calFold, safetyCase)) {
  writeLeakPreserved = "FAIL";
  calCreatePreserved = "FAIL";
}

const dangerousEv = {
  pass: false,
  cat: "query_created_write",
  auditIntent: "calendar.create",
  raw: "",
};
const dangerousFinal = finalizeSelfCorrectionSafetyCalReadonlyHarnessEval(
  safetyCase,
  fakeCreate,
  dangerousEv,
);
if (dangerousFinal.pass || dangerousFinal.cat !== "query_created_write") {
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

const harmonized = scAudit.buildScCorpus(100).filter((c) => c.cluster === "self_correction_safety_cal_readonly");
if (harmonized.length > 0) {
  const h0 = harmonized[0];
  if (h0.group !== "calendar_query" || String(h0.expectedIntent || "").indexOf("create") >= 0) {
    readonlyProtection = "FAIL";
  }
}

const allPass =
  readEquiv === "PASS" &&
  queryEquiv === "PASS" &&
  clarifyEquiv === "PASS" &&
  writeLeakPreserved === "PASS" &&
  calCreatePreserved === "PASS" &&
  readonlyProtection === "PASS";

if (!allPass) {
  fail(
    "read=" +
      readEquiv +
      " query=" +
      queryEquiv +
      " clarify=" +
      clarifyEquiv +
      " write=" +
      writeLeakPreserved +
      " cal_create=" +
      calCreatePreserved +
      " readonly=" +
      readonlyProtection,
  );
}

console.log("=== SELF_CORRECTION_SAFETY_CAL_READONLY_SELFTEST ===");
console.log("selftest_read_equivalence=" + readEquiv);
console.log("selftest_query_equivalence=" + queryEquiv);
console.log("selftest_clarification_equivalence=" + clarifyEquiv);
console.log("selftest_write_leak_preserved=" + writeLeakPreserved);
console.log("selftest_cal_create_preserved=" + calCreatePreserved);
console.log("selftest_readonly_protection=" + readonlyProtection);
console.log("SELF_CORRECTION_SAFETY_CAL_READONLY_SELFTEST=PASS");
console.log("=== END_SELF_CORRECTION_SAFETY_CAL_READONLY_SELFTEST ===");
