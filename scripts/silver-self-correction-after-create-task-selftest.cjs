#!/usr/bin/env node
/**
 * Regression tests: self_correction_after_create_task harness alignment (scripts only).
 * Preserves tasks.create on clean surfaces; no spurious PASS on write/safety leaks.
 */
/* eslint-disable no-console */
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const scAudit = require("./silver-self-correction-audit.cjs");
const {
  afterCreateTaskHarnessCueFolded,
  finalizeSelfCorrectionAfterCreateTaskHarnessEval,
  isSelfCorrectionAfterCreateTaskHarnessCase,
} = require("./silver-self-correction-query-clarification.cjs");
const { loadEngine, evaluateOne, ctxForCase, foldCs } = harness;

function fail(msg) {
  console.log("SELF_CORRECTION_AFTER_CREATE_TASK_SELFTEST=FAIL " + msg);
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
let taskCreatePreserved = "PASS";
let cueDetect = "PASS";

const afterCreateFold = foldCs(
  "hele promin Hod do ukolu zavolat pravnikovi v patek, ne do kalendare, oprav to jako na v patek. diky prosim rychle",
);
if (!afterCreateTaskHarnessCueFolded(afterCreateFold)) {
  cueDetect = "FAIL";
}

const afterCreateCase = {
  cluster: "self_correction_after_create_task",
  group: "task_write",
  expectedIntent: "task.create",
  input:
    "hele promin Hod do ukolu zavolat pravnikovi v patek, ne do kalendare, oprav to jako na v patek. diky prosim rychle",
  sc_lane: "correction_after_create_intent",
  gold: { expected_should_write: true },
};

if (!isSelfCorrectionAfterCreateTaskHarnessCase(afterCreateCase)) {
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
  ev = finalizeSelfCorrectionAfterCreateTaskHarnessEval(c, turn, ev);
  return { turn, ev };
}

const afterCreateRun = runTurn(afterCreateCase);
const engAfterCreate = String(afterCreateRun.turn.normalizedIntent || "");
if (engAfterCreate === "tasks.create" && String(afterCreateRun.turn.processingState || "") === "READY_TO_SAVE") {
  if (!afterCreateRun.ev.pass) {
    clarifyEquiv = "FAIL";
  }
} else if (createLikeTurn(afterCreateRun.turn) && engAfterCreate === "calendar.create") {
  writeLeakPreserved = "FAIL";
} else if (
  engAfterCreate === "clarification" ||
  engAfterCreate === "unknown" ||
  engAfterCreate === "create.storage_disambiguation"
) {
  if (!afterCreateRun.ev.pass || afterCreateRun.ev.cat !== "sc_after_create_task_harness_ok") {
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
  return finalizeSelfCorrectionAfterCreateTaskHarnessEval(c, turn, baseEv);
}

const storageSynthetic = {
  normalizedIntent: "create.storage_disambiguation",
  processingState: "STORAGE_DISAMBIGUATION",
  draft: {},
};
const storageEv = finalizeHarnessIntentFail(afterCreateCase, storageSynthetic, "create.storage_disambiguation");
if (!storageEv.pass || storageEv.cat !== "sc_after_create_task_harness_ok") {
  clarifyEquiv = "FAIL";
}

const fakeCalCreateTurn = {
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
const dangerousFinal = finalizeSelfCorrectionAfterCreateTaskHarnessEval(
  afterCreateCase,
  fakeCalCreateTurn,
  dangerousEv,
);
if (dangerousFinal.pass || dangerousFinal.cat !== "query_created_write") {
  writeLeakPreserved = "FAIL";
}

const taskCreateCase = {
  input: "Přidej úkol zavolat právníkovi v pátek.",
  cluster: "guard_normal_task_create",
  group: "task_write",
  expectedIntent: "task.create",
};
const taskRun = runTurn({
  input: taskCreateCase.input,
  cluster: taskCreateCase.cluster,
  group: taskCreateCase.group,
  expectedIntent: taskCreateCase.expectedIntent,
  sc_lane: "safety_regression",
});
if (String(taskRun.turn.normalizedIntent || "") !== "tasks.create" || !taskRun.ev.pass) {
  taskCreatePreserved = "FAIL";
}

const harmonized = scAudit.buildScCorpus(2100).filter((c) => c.cluster === "self_correction_after_create_task");
if (harmonized.length < 1) {
  cueDetect = "FAIL";
}

const allPass =
  clarifyEquiv === "PASS" &&
  writeLeakPreserved === "PASS" &&
  taskCreatePreserved === "PASS" &&
  cueDetect === "PASS";

if (!allPass) {
  fail(
    "clarify=" +
      clarifyEquiv +
      " write=" +
      writeLeakPreserved +
      " task_create=" +
      taskCreatePreserved +
      " cue=" +
      cueDetect,
  );
}

console.log("=== SELF_CORRECTION_AFTER_CREATE_TASK_SELFTEST ===");
console.log("selftest_clarification_equivalence=" + clarifyEquiv);
console.log("selftest_write_leak_preserved=" + writeLeakPreserved);
console.log("selftest_task_create_preserved=" + taskCreatePreserved);
console.log("selftest_after_create_cue_detect=" + cueDetect);
console.log("SELF_CORRECTION_AFTER_CREATE_TASK_SELFTEST=PASS");
