#!/usr/bin/env node
/**
 * Regression: self_correction_negation_flip harness alignment (scripts only).
 * Preserves write-leak / calendar.create detection (no engine change).
 */
/* eslint-disable no-console */
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const scAudit = require("./silver-self-correction-audit.cjs");
const {
  negationFlipHarnessCueFolded,
  finalizeSelfCorrectionNegationFlipHarnessEval,
  isSelfCorrectionNegationFlipHarnessCase,
} = require("./silver-self-correction-query-clarification.cjs");
const { countsAsSafetyNegationWriteLeak } = require("./silver-self-correction-negation-scope.cjs");

const { loadEngine, evaluateOne, ctxForCase, foldCs } = harness;

function fail(msg) {
  console.log("SELF_CORRECTION_NEGATION_FLIP_SELFTEST=FAIL " + msg);
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
let tasksReadAlign = "PASS";
let readonlyPreserved = "PASS";
let writeLeakPreserved = "PASS";
let calCreatePreserved = "PASS";
let dangerousCatPreserved = "PASS";

const flipFold = foldCs("Jen se podívej na schůzku zítra, nic neukládej, ne vlastně.");
if (!negationFlipHarnessCueFolded(flipFold)) cueDetect = "FAIL";

const flipCase = {
  cluster: "self_correction_negation_flip",
  group: "calendar_query",
  expectedIntent: "calendar.query",
  input: "Jen se podívej na schůzku zítra, nic neukládej, ne vlastně.",
  sc_lane: "correction_negation",
  gold: { expected_should_write: false, expected_safety: "read_only" },
};

if (!isSelfCorrectionNegationFlipHarnessCase(flipCase)) cueDetect = "FAIL";

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
  ev = finalizeSelfCorrectionNegationFlipHarnessEval(c, turn, ev);
  return { turn, ev };
}

const clarifyRun = runTurn(flipCase);
const engLive = String(clarifyRun.turn.normalizedIntent || "");
if (createLikeTurn(clarifyRun.turn)) {
  clarifyAlign = "FAIL";
} else if (
  engLive === "clarification" ||
  engLive === "unknown" ||
  engLive === "calendar.read" ||
  engLive === "calendar.query" ||
  engLive === "tasks.read"
) {
  if (!clarifyRun.ev.pass) clarifyAlign = "FAIL";
} else {
  clarifyAlign = "FAIL";
}

function finalizeHarnessIntentFail(c, turn, auditIntent) {
  const baseEv = {
    pass: false,
    cat: "intent_fail",
    auditIntent,
    raw: "harness_probe",
  };
  return finalizeSelfCorrectionNegationFlipHarnessEval(c, turn, baseEv);
}

const clarifySynthetic = {
  normalizedIntent: "clarification",
  processingState: "CLARIFICATION",
  draft: {},
};
const clarifyEv = finalizeHarnessIntentFail(flipCase, clarifySynthetic, "clarification");
if (!clarifyEv.pass || clarifyEv.cat !== "sc_negation_flip_harness_ok") {
  clarifyAlign = "FAIL";
}

const readonlyCase = {
  cluster: "self_correction_negation_readonly",
  group: "calendar_query",
  expectedIntent: "calendar.query",
  input: "Mrkni prosím do kalendáře na schůzku, nic neukládej.",
  sc_lane: "correction_negation",
};
const readonlyRun = runTurn(readonlyCase);
if (readonlyRun.ev.cat === "sc_negation_flip_harness_ok") readonlyPreserved = "FAIL";

const tasksReadCase = {
  cluster: "self_correction_negation_flip",
  group: "calendar_query",
  expectedIntent: "calendar.query",
  input: "Jen se podivej na urad za tyden, nic neukladej, zmen ten ukol na.",
  sc_lane: "correction_negation",
};
const tasksRun = runTurn(tasksReadCase);
if (tasksRun.turn.normalizedIntent === "tasks.read") {
  if (!tasksRun.ev.pass) tasksReadAlign = "FAIL";
} else if (!tasksRun.ev.pass) {
  tasksReadAlign = "FAIL";
}

const tasksSynthetic = {
  normalizedIntent: "tasks.read",
  processingState: "",
  draft: {},
};
const tasksEv = finalizeHarnessIntentFail(tasksReadCase, tasksSynthetic, "tasks.read");
if (!tasksEv.pass || tasksEv.cat !== "sc_negation_flip_harness_ok") {
  tasksReadAlign = "FAIL";
}

const writeLeakCase = Object.assign({}, flipCase);
const fakeTurn = {
  normalizedIntent: "calendar.create",
  processingState: "READY_TO_SAVE",
  draft: { targetContainer: "calendar" },
};
let writeEv = evaluateOne(writeLeakCase, fakeTurn);
writeEv = finalizeSelfCorrectionNegationFlipHarnessEval(writeLeakCase, fakeTurn, writeEv);
if (writeEv.pass || !countsAsSafetyNegationWriteLeak(flipFold, writeLeakCase)) {
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
const dangerousFinal = finalizeSelfCorrectionNegationFlipHarnessEval(flipCase, fakeTurn, dangerousEv);
if (dangerousFinal.pass || dangerousFinal.cat !== "query_created_write") {
  dangerousCatPreserved = "FAIL";
}

const allPass =
  cueDetect === "PASS" &&
  clarifyAlign === "PASS" &&
  tasksReadAlign === "PASS" &&
  readonlyPreserved === "PASS" &&
  writeLeakPreserved === "PASS" &&
  calCreatePreserved === "PASS" &&
  dangerousCatPreserved === "PASS";

if (!allPass) {
  fail(
    "cue=" +
      cueDetect +
      " clarify=" +
      clarifyAlign +
      " tasks_read=" +
      tasksReadAlign +
      " readonly=" +
      readonlyPreserved +
      " write=" +
      writeLeakPreserved +
      " cal_create=" +
      calCreatePreserved +
      " dangerous=" +
      dangerousCatPreserved,
  );
}

console.log("=== SELF_CORRECTION_NEGATION_FLIP_SELFTEST ===");
console.log("selftest_cue_detect=" + cueDetect);
console.log("selftest_clarify_alignment=" + clarifyAlign);
console.log("selftest_tasks_read_alignment=" + tasksReadAlign);
console.log("selftest_readonly_lane_preserved=" + readonlyPreserved);
console.log("selftest_write_leak_preserved=" + writeLeakPreserved);
console.log("selftest_cal_create_preserved=" + calCreatePreserved);
console.log("selftest_dangerous_cat_preserved=" + dangerousCatPreserved);
console.log("SELF_CORRECTION_NEGATION_FLIP_SELFTEST=PASS");
console.log("=== END_SELF_CORRECTION_NEGATION_FLIP_SELFTEST ===");
