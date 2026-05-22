#!/usr/bin/env node
/**
 * Regression: self_correction_safety_note_readonly harness alignment (scripts only).
 * Preserves notes.create leak / dangerous_write detection (no engine change).
 */
/* eslint-disable no-console */
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const scAudit = require("./silver-self-correction-audit.cjs");
const {
  safetyNoteReadonlyHarnessCueFolded,
  finalizeSelfCorrectionSafetyNoteReadonlyHarnessEval,
  isSelfCorrectionSafetyNoteReadonlyHarnessCase,
} = require("./silver-self-correction-query-clarification.cjs");
const { countsAsSafetyNegationWriteLeak } = require("./silver-self-correction-negation-scope.cjs");

const { loadEngine, evaluateOne, ctxForCase, foldCs } = harness;

function fail(msg) {
  console.log("SELF_CORRECTION_SAFETY_NOTE_READONLY_SELFTEST=FAIL " + msg);
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
let clarifyEquiv = "PASS";
let writeLeakPreserved = "PASS";
let noteCreatePreserved = "PASS";
let readonlyProtection = "PASS";

const noteFold = foldCs("Kde mám uložené právník? Nic nevytvářej.");
if (!safetyNoteReadonlyHarnessCueFolded(noteFold)) {
  fail("cue_detect");
}

const safetyCase = {
  cluster: "self_correction_safety_note_readonly",
  group: "note_query",
  expectedIntent: "note.query",
  input: "Kde mám uložené právník? Nic nevytvářej.",
  sc_lane: "safety_regression",
  gold: { expected_should_write: false, expected_safety: "read_only" },
};

if (!isSelfCorrectionSafetyNoteReadonlyHarnessCase(safetyCase)) {
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
  ev = finalizeSelfCorrectionSafetyNoteReadonlyHarnessEval(c, turn, ev);
  return { turn, ev };
}

const liveRun = runTurn(safetyCase);
const engLive = String(liveRun.turn.normalizedIntent || "");
if (createLikeTurn(liveRun.turn)) {
  writeLeakPreserved = "FAIL";
  readonlyProtection = "FAIL";
} else if (engLive === "notes.read") {
  if (!liveRun.ev.pass) {
    readEquiv = "FAIL";
  }
} else if (engLive === "clarification" || engLive === "unknown") {
  if (!liveRun.ev.pass) {
    clarifyEquiv = "FAIL";
  }
} else {
  readEquiv = "FAIL";
  clarifyEquiv = "FAIL";
}

function finalizeHarnessIntentFail(c, turn, auditIntent) {
  const baseEv = {
    pass: false,
    cat: "intent_fail",
    auditIntent,
    raw: "harness_probe",
  };
  return finalizeSelfCorrectionSafetyNoteReadonlyHarnessEval(c, turn, baseEv);
}

const readSynthetic = {
  normalizedIntent: "notes.read",
  processingState: "",
  draft: {},
};
const readEv = finalizeHarnessIntentFail(safetyCase, readSynthetic, "note.query");
if (!readEv.pass || readEv.cat !== "sc_safety_note_readonly_harness_ok") {
  readEquiv = "FAIL";
}

const clarifySynthetic = {
  normalizedIntent: "clarification",
  processingState: "",
  draft: {},
};
const clarifyEv = finalizeHarnessIntentFail(safetyCase, clarifySynthetic, "clarification");
if (!clarifyEv.pass || clarifyEv.cat !== "sc_safety_note_readonly_harness_ok") {
  clarifyEquiv = "FAIL";
}

const fakeCreate = {
  normalizedIntent: "notes.create",
  processingState: "READY_TO_SAVE",
  draft: { targetContainer: "notes" },
};
let createEv = evaluateOne(safetyCase, fakeCreate);
createEv = finalizeSelfCorrectionSafetyNoteReadonlyHarnessEval(safetyCase, fakeCreate, createEv);
if (createEv.pass || !countsAsSafetyNegationWriteLeak(noteFold, safetyCase)) {
  writeLeakPreserved = "FAIL";
  noteCreatePreserved = "FAIL";
}

const dangerousEv = {
  pass: false,
  cat: "query_created_write",
  auditIntent: "notes.create",
  raw: "",
};
const dangerousFinal = finalizeSelfCorrectionSafetyNoteReadonlyHarnessEval(
  safetyCase,
  fakeCreate,
  dangerousEv,
);
if (dangerousFinal.pass || dangerousFinal.cat !== "query_created_write") {
  writeLeakPreserved = "FAIL";
}

const noteCreateCase = {
  input: "Ulož do poznámek právník zítra.",
  cluster: "guard_normal_note_create",
  group: "note_write",
  expectedIntent: "note.create",
  sc_lane: "safety_regression",
};
const noteRun = runTurn(noteCreateCase);
if (!createLikeTurn(noteRun.turn) || !noteRun.ev.pass) {
  noteCreatePreserved = "FAIL";
}

const harmonized = scAudit.buildScCorpus(100).filter((c) => c.cluster === "self_correction_safety_note_readonly");
if (harmonized.length > 0) {
  const h0 = harmonized[0];
  if (h0.group !== "note_query" || String(h0.expectedIntent || "").indexOf("create") >= 0) {
    readonlyProtection = "FAIL";
  }
}

const allPass =
  readEquiv === "PASS" &&
  clarifyEquiv === "PASS" &&
  writeLeakPreserved === "PASS" &&
  noteCreatePreserved === "PASS" &&
  readonlyProtection === "PASS";

if (!allPass) {
  fail(
    "read=" +
      readEquiv +
      " clarify=" +
      clarifyEquiv +
      " write=" +
      writeLeakPreserved +
      " note_create=" +
      noteCreatePreserved +
      " readonly=" +
      readonlyProtection,
  );
}

console.log("=== SELF_CORRECTION_SAFETY_NOTE_READONLY_SELFTEST ===");
console.log("selftest_read_equivalence=" + readEquiv);
console.log("selftest_clarification_equivalence=" + clarifyEquiv);
console.log("selftest_write_leak_preserved=" + writeLeakPreserved);
console.log("selftest_note_create_preserved=" + noteCreatePreserved);
console.log("selftest_readonly_protection=" + readonlyProtection);
console.log("SELF_CORRECTION_SAFETY_NOTE_READONLY_SELFTEST=PASS");
console.log("=== END_SELF_CORRECTION_SAFETY_NOTE_READONLY_SELFTEST ===");
