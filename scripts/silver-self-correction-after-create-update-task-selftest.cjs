/**
 * P0 selftest: self_correction_after_create_task + self_correction_update_task engine routes.
 */
/* eslint-disable no-console */
const sc = require("./silver-self-correction-audit.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const scq = require("./silver-self-correction-query-clarification.cjs");
const { loadEngine, evaluateOne, applyHarnessExpectationHarmonization, ctxForCase } = harness;
const { computeGoldLabels } = rhc3;

const MUST = [
  {
    input: "Hoď do úkolů zaplatit nájem v pátek, ne do kalendáře, změň ten úkol na pozítří.",
    cluster: "self_correction_after_create_task",
    group: "task_write",
    expectedIntent: "task.create",
  },
  {
    input: "hele Hod do nejak ukolu doplnit smlouvu ve ctvrtek, ne do kalendare, ne vlastne o vikendu.",
    cluster: "self_correction_after_create_task",
    group: "task_write",
    expectedIntent: "task.create",
  },
  {
    input: "Uprav ten úkol zavolat právníkovi na ve čtvrtek, ne nový úkol, ne vlastně.",
    cluster: "self_correction_update_task",
    group: "task_write",
    expectedIntent: "task.create",
  },
];

function applyAll(c, turn, ev) {
  let out = ev;
  out = rhc3.finalizeModuleSwitchHarnessEval(c, turn, out);
  out = rhc3.finalizeModuleSwitchClarifyLaneHarnessEval(c, turn, out);
  out = rhc3.finalizeModuleSwitchTaskToNoteHarnessEval(c, turn, out);
  out = rhc3.finalizeModuleSwitchNegJakoCalToNoteHarnessEval(c, turn, out);
  out = scq.finalizeSelfCorrectionUpdateNoteHarnessEval(c, turn, out);
  return out;
}

function evalMust(row) {
  const c = Object.assign({ sc_lane: "correction_after_create_intent", family: "self_correction" }, row);
  applyHarnessExpectationHarmonization([c]);
  c.gold = computeGoldLabels(c);
  c.expectedIntent = c.gold.expected_intent;
  const eng = loadEngine();
  if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
  let ev = evaluateOne(c, turn);
  ev = applyAll(c, turn, ev);
  return { turn, ev };
}

function main() {
  let fail = 0;
  for (let i = 0; i < MUST.length; i++) {
    const r = evalMust(MUST[i]);
    if (!r.ev.pass || r.turn.normalizedIntent !== "tasks.create" || r.turn.processingState !== "READY_TO_SAVE") {
      fail++;
      console.log(
        "FAIL_MUST cluster=" +
          MUST[i].cluster +
          " eng=" +
          r.turn.normalizedIntent +
          " state=" +
          r.turn.processingState
      );
    }
  }
  const clusters = ["self_correction_after_create_task", "self_correction_update_task"];
  const eng = loadEngine();
  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];
    const cases = sc.buildScCorpus(6000).filter((x) => x.cluster === cluster);
    applyHarnessExpectationHarmonization(cases);
    for (let i = 0; i < cases.length; i++) cases[i].gold = computeGoldLabels(cases[i]);
    let clusterFail = 0;
    for (const c of cases) {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
      const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
      let ev = evaluateOne(c, turn);
      ev = applyAll(c, turn, ev);
      if (!ev.pass) clusterFail++;
    }
    console.log("cluster=" + cluster + " cases=" + cases.length + " fail=" + clusterFail);
    fail += clusterFail;
  }
  console.log("silver_self_correction_after_create_update_task_selftest_fail=" + fail);
  process.exit(fail > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}
