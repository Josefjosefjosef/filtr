#!/usr/bin/env node
/**
 * Regression: self_correction_update_task harness alignment + engine route (scripts only).
 * Preserves tasks.create leak / dangerous_write detection (no spurious PASS on write leak).
 */
/* eslint-disable no-console */
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const scAudit = require("./silver-self-correction-audit.cjs");
const {
  updateTaskHarnessCueFolded,
  finalizeSelfCorrectionUpdateTaskHarnessEval,
  isSelfCorrectionUpdateTaskHarnessCase,
} = require("./silver-self-correction-query-clarification.cjs");
const { loadEngine, evaluateOne, ctxForCase, foldCs } = harness;

function fail(msg) {
  console.log("SELF_CORRECTION_UPDATE_TASK_SELFTEST=FAIL " + msg);
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
let updateCueDetect = "PASS";

const taskFold = foldCs(
  "Uprav ten úkol zavolat právníkovi na ve čtvrtek, ne nový úkol, ne vlastně."
);
if (!updateTaskHarnessCueFolded(taskFold)) {
  updateCueDetect = "FAIL";
}

const updateCase = {
  cluster: "self_correction_update_task",
  group: "task_write",
  expectedIntent: "task.create",
  input: "Uprav ten úkol zavolat právníkovi na ve čtvrtek, ne nový úkol, ne vlastně.",
  sc_lane: "correction_update_vs_create",
  meta: { updateVsCreate: true, preferUpdate: true },
  gold: { expected_should_write: true },
};

if (!isSelfCorrectionUpdateTaskHarnessCase(updateCase)) {
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
  ev = finalizeSelfCorrectionUpdateTaskHarnessEval(c, turn, ev);
  return { turn, ev };
}

const noisyClarifyCase = {
  cluster: "self_correction_update_task",
  group: "task_write",
  expectedIntent: "task.create",
  input:
    "hele Uprav ten úkol doplnit smlouvu na pozítří, ne nový trochu úkol, vlastně zejtra ne dnes. díky",
  sc_lane: "correction_update_vs_create",
  meta: { updateVsCreate: true, preferUpdate: true },
  gold: { expected_should_write: true },
};

const noisyRun = runTurn(noisyClarifyCase);
const engNoisy = String(noisyRun.turn.normalizedIntent || "");
if (engNoisy === "tasks.create" && String(noisyRun.turn.processingState || "") === "READY_TO_SAVE") {
  if (!noisyRun.ev.pass) {
    clarifyEquiv = "FAIL";
  }
} else if (createLikeTurn(noisyRun.turn) && engNoisy === "calendar.create") {
  writeLeakPreserved = "FAIL";
} else if (
  engNoisy === "clarification" ||
  engNoisy === "unknown" ||
  engNoisy === "create.storage_disambiguation"
) {
  if (!noisyRun.ev.pass || noisyRun.ev.cat !== "sc_update_task_harness_ok") {
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
  return finalizeSelfCorrectionUpdateTaskHarnessEval(c, turn, baseEv);
}

const clarifySynthetic = {
  normalizedIntent: "clarification",
  processingState: "",
  draft: {},
};
const clarifyEv = finalizeHarnessIntentFail(updateCase, clarifySynthetic, "clarification");
if (!clarifyEv.pass || clarifyEv.cat !== "sc_update_task_harness_ok") {
  clarifyEquiv = "FAIL";
}

const fakeCreate = {
  normalizedIntent: "tasks.create",
  processingState: "READY_TO_SAVE",
  draft: { targetContainer: "tasks" },
};
let createEv = evaluateOne(updateCase, fakeCreate);
createEv = finalizeSelfCorrectionUpdateTaskHarnessEval(updateCase, fakeCreate, createEv);
if (createEv.pass) {
  writeLeakPreserved = "FAIL";
}

const dangerousEv = {
  pass: false,
  cat: "query_created_write",
  auditIntent: "tasks.create",
  raw: "",
};
const dangerousFinal = finalizeSelfCorrectionUpdateTaskHarnessEval(updateCase, fakeCreate, dangerousEv);
if (dangerousFinal.pass || dangerousFinal.cat !== "query_created_write") {
  writeLeakPreserved = "FAIL";
}

const taskCreateCase = {
  input: "Přidej úkol zavolat Pavlovi.",
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
if (!createLikeTurn(taskRun.turn)) {
  taskCreatePreserved = "FAIL";
}

const harmonized = scAudit.buildScCorpus(2100).filter((c) => c.cluster === "self_correction_update_task");
if (harmonized.length < 1) {
  updateCueDetect = "FAIL";
}

const allPass =
  clarifyEquiv === "PASS" &&
  writeLeakPreserved === "PASS" &&
  taskCreatePreserved === "PASS" &&
  updateCueDetect === "PASS";

if (!allPass) {
  fail(
    "clarify=" +
      clarifyEquiv +
      " write=" +
      writeLeakPreserved +
      " task_create=" +
      taskCreatePreserved +
      " cue=" +
      updateCueDetect
  );
}

console.log("=== SELF_CORRECTION_UPDATE_TASK_SELFTEST ===");
console.log("selftest_clarification_equivalence=" + clarifyEquiv);
console.log("selftest_write_leak_preserved=" + writeLeakPreserved);
console.log("selftest_task_create_preserved=" + taskCreatePreserved);
console.log("selftest_update_cue_detect=" + updateCueDetect);
console.log("SELF_CORRECTION_UPDATE_TASK_SELFTEST=PASS");
console.log("=== END_SELF_CORRECTION_UPDATE_TASK_SELFTEST ===");
