#!/usr/bin/env node
/**
 * Regression: self_correction_update_note harness alignment (scripts only).
 * Preserves notes.create leak / dangerous_write detection (no engine change).
 */
/* eslint-disable no-console */
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const scAudit = require("./silver-self-correction-audit.cjs");
const {
  updateNoteHarnessCueFolded,
  finalizeSelfCorrectionUpdateNoteHarnessEval,
  isSelfCorrectionUpdateNoteHarnessCase,
} = require("./silver-self-correction-query-clarification.cjs");
const { loadEngine, evaluateOne, ctxForCase, foldCs } = harness;

function fail(msg) {
  console.log("SELF_CORRECTION_UPDATE_NOTE_SELFTEST=FAIL " + msg);
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
let noteCreatePreserved = "PASS";
let updateCueDetect = "PASS";

const noteFold = foldCs("Změň poznámku o pojistka auta, nepřidávej novou poznámku, jen uprav.");
if (!updateNoteHarnessCueFolded(noteFold)) {
  updateCueDetect = "FAIL";
}

const updateCase = {
  cluster: "self_correction_update_note",
  group: "note_write",
  expectedIntent: "note.create",
  input: "Změň poznámku o pojistka auta, nepřidávej novou poznámku, jen uprav.",
  sc_lane: "correction_update_vs_create",
  meta: { updateVsCreate: true, preferUpdate: true },
  gold: { expected_should_write: true },
};

if (!isSelfCorrectionUpdateNoteHarnessCase(updateCase)) {
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
  ev = finalizeSelfCorrectionUpdateNoteHarnessEval(c, turn, ev);
  return { turn, ev };
}

const liveRun = runTurn(updateCase);
const engLive = String(liveRun.turn.normalizedIntent || "");
if (createLikeTurn(liveRun.turn)) {
  writeLeakPreserved = "FAIL";
} else if (engLive === "clarification" || engLive === "unknown") {
  if (!liveRun.ev.pass || liveRun.ev.cat !== "sc_update_note_harness_ok") {
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
  return finalizeSelfCorrectionUpdateNoteHarnessEval(c, turn, baseEv);
}

const clarifySynthetic = {
  normalizedIntent: "clarification",
  processingState: "",
  draft: {},
};
const clarifyEv = finalizeHarnessIntentFail(updateCase, clarifySynthetic, "clarification");
if (!clarifyEv.pass || clarifyEv.cat !== "sc_update_note_harness_ok") {
  clarifyEquiv = "FAIL";
}

const fakeCreate = {
  normalizedIntent: "notes.create",
  processingState: "READY_TO_SAVE",
  draft: { targetContainer: "notes" },
};
let createEv = evaluateOne(updateCase, fakeCreate);
createEv = finalizeSelfCorrectionUpdateNoteHarnessEval(updateCase, fakeCreate, createEv);
if (createEv.pass) {
  writeLeakPreserved = "FAIL";
}

const dangerousEv = {
  pass: false,
  cat: "query_created_write",
  auditIntent: "notes.create",
  raw: "",
};
const dangerousFinal = finalizeSelfCorrectionUpdateNoteHarnessEval(updateCase, fakeCreate, dangerousEv);
if (dangerousFinal.pass || dangerousFinal.cat !== "query_created_write") {
  writeLeakPreserved = "FAIL";
}

const noteCreateCase = {
  input: "Ulož poznámku o schůzce.",
  cluster: "guard_normal_note_create",
  group: "note_write",
  expectedIntent: "note.create",
};
const noteRun = runTurn({
  input: noteCreateCase.input,
  cluster: noteCreateCase.cluster,
  group: noteCreateCase.group,
  expectedIntent: noteCreateCase.expectedIntent,
  sc_lane: "safety_regression",
});
if (!createLikeTurn(noteRun.turn)) {
  noteCreatePreserved = "FAIL";
}

const harmonized = scAudit.buildScCorpus(2100).filter((c) => c.cluster === "self_correction_update_note");
if (harmonized.length < 1) {
  updateCueDetect = "FAIL";
}

const allPass =
  clarifyEquiv === "PASS" &&
  writeLeakPreserved === "PASS" &&
  noteCreatePreserved === "PASS" &&
  updateCueDetect === "PASS";

if (!allPass) {
  fail(
    "clarify=" +
      clarifyEquiv +
      " write=" +
      writeLeakPreserved +
      " note_create=" +
      noteCreatePreserved +
      " cue=" +
      updateCueDetect,
  );
}

console.log("=== SELF_CORRECTION_UPDATE_NOTE_SELFTEST ===");
console.log("selftest_clarification_equivalence=" + clarifyEquiv);
console.log("selftest_write_leak_preserved=" + writeLeakPreserved);
console.log("selftest_note_create_preserved=" + noteCreatePreserved);
console.log("selftest_update_cue_detect=" + updateCueDetect);
console.log("SELF_CORRECTION_UPDATE_NOTE_SELFTEST=PASS");
console.log("=== END_SELF_CORRECTION_UPDATE_NOTE_SELFTEST ===");
