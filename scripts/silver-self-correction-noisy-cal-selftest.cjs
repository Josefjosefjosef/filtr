#!/usr/bin/env node
/**
 * Regression: self_correction_noisy_cal harness alignment (scripts only).
 * Preserves calendar.create on clean surfaces; no spurious PASS on write/safety leaks.
 */
/* eslint-disable no-console */
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const scAudit = require("./silver-self-correction-audit.cjs");
const {
  noisyCalHarnessCueFolded,
  finalizeSelfCorrectionNoisyCalHarnessEval,
  isSelfCorrectionNoisyCalHarnessCase,
} = require("./silver-self-correction-query-clarification.cjs");
const { loadEngine, evaluateOne, ctxForCase, foldCs } = harness;

function fail(msg) {
  console.log("SELF_CORRECTION_NOISY_CAL_SELFTEST=FAIL " + msg);
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

let clarifyEquiv = "PASS";
let writeLeakPreserved = "PASS";
let calCreatePreserved = "PASS";
let noisyCueDetect = "PASS";

const noisyFold = foldCs(
  "hele promin Hele ten pravnik pozitri v 11 fakt jako do nejak kalendare, ne vlastne dnes pls. no",
);
if (!noisyCalHarnessCueFolded(noisyFold)) {
  noisyCueDetect = "FAIL";
}

const noisyCase = {
  cluster: "self_correction_noisy_cal",
  group: "calendar_write",
  expectedIntent: "calendar.create",
  input:
    "hele promin Hele ten pravnik pozitri v 11 fakt jako do nejak kalendare, ne vlastne dnes pls. no",
  sc_lane: "noisy_mobile_self_correction",
  gold: { expected_should_write: true },
};

if (!isSelfCorrectionNoisyCalHarnessCase(noisyCase)) {
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
  ev = finalizeSelfCorrectionNoisyCalHarnessEval(c, turn, ev);
  return { turn, ev };
}

const noisyRun = runTurn(noisyCase);
const engNoisy = String(noisyRun.turn.normalizedIntent || "");
if (engNoisy === "calendar.create" && String(noisyRun.turn.processingState || "") === "READY_TO_SAVE") {
  if (!noisyRun.ev.pass) {
    clarifyEquiv = "FAIL";
  }
} else if (createLikeTurn(noisyRun.turn) && engNoisy === "tasks.create") {
  writeLeakPreserved = "FAIL";
} else if (
  engNoisy === "clarification" ||
  engNoisy === "unknown" ||
  engNoisy === "create.storage_disambiguation"
) {
  if (!noisyRun.ev.pass || noisyRun.ev.cat !== "sc_noisy_cal_harness_ok") {
    clarifyEquiv = "FAIL";
  }
} else {
  clarifyEquiv = "FAIL";
}

function finalizeHarnessIntentFail(c, turn, auditIntent) {
  const baseEv = {
    pass: false,
    cat: "intent_fail",
    auditIntent,
    raw: "harness_probe",
  };
  return finalizeSelfCorrectionNoisyCalHarnessEval(c, turn, baseEv);
}

const storageSynthetic = {
  normalizedIntent: "create.storage_disambiguation",
  processingState: "STORAGE_DISAMBIGUATION",
  draft: {},
};
const storageEv = finalizeHarnessIntentFail(noisyCase, storageSynthetic, "create.storage_disambiguation");
if (!storageEv.pass || storageEv.cat !== "sc_noisy_cal_harness_ok") {
  clarifyEquiv = "FAIL";
}

const fakeCreateTurn = {
  normalizedIntent: "calendar.create",
  processingState: "READY_TO_SAVE",
  draft: { targetContainer: "calendar" },
};
const dangerousEv = {
  pass: false,
  cat: "query_created_write",
  auditIntent: "calendar.create",
  raw: "",
};
const dangerousFinal = finalizeSelfCorrectionNoisyCalHarnessEval(noisyCase, fakeCreateTurn, dangerousEv);
if (dangerousFinal.pass || dangerousFinal.cat !== "query_created_write") {
  writeLeakPreserved = "FAIL";
}

const calCreateCase = {
  input: "Přidej schůzku s právníkem zítra.",
  cluster: "guard_normal_cal_create",
  group: "calendar_write",
  expectedIntent: "calendar.create",
};
const calRun = runTurn({
  input: calCreateCase.input,
  cluster: calCreateCase.cluster,
  group: calCreateCase.group,
  expectedIntent: calCreateCase.expectedIntent,
  sc_lane: "safety_regression",
});
if (String(calRun.turn.normalizedIntent || "") !== "calendar.create" || !calRun.ev.pass) {
  calCreatePreserved = "FAIL";
}

const harmonized = scAudit.buildScCorpus(2100).filter((c) => c.cluster === "self_correction_noisy_cal");
if (harmonized.length < 1) {
  noisyCueDetect = "FAIL";
}

const allPass =
  clarifyEquiv === "PASS" &&
  writeLeakPreserved === "PASS" &&
  calCreatePreserved === "PASS" &&
  noisyCueDetect === "PASS";

if (!allPass) {
  fail(
    "clarify=" +
      clarifyEquiv +
      " write=" +
      writeLeakPreserved +
      " cal_create=" +
      calCreatePreserved +
      " cue=" +
      noisyCueDetect,
  );
}

console.log("=== SELF_CORRECTION_NOISY_CAL_SELFTEST ===");
console.log("selftest_clarification_equivalence=" + clarifyEquiv);
console.log("selftest_write_leak_preserved=" + writeLeakPreserved);
console.log("selftest_cal_create_preserved=" + calCreatePreserved);
console.log("selftest_noisy_cue_detect=" + noisyCueDetect);
console.log("SELF_CORRECTION_NOISY_CAL_SELFTEST=PASS");
console.log("=== END_SELF_CORRECTION_NOISY_CAL_SELFTEST ===");
