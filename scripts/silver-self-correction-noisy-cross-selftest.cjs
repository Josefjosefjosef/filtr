/**
 * P0 selftest: self_correction_noisy_cross engine routing (note lead → ne vlastně úkol → tasks.create).
 * Usage: node scripts/silver-self-correction-noisy-cross-selftest.cjs
 */
/* eslint-disable no-console */
const sc = require("./silver-self-correction-audit.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const scq = require("./silver-self-correction-query-clarification.cjs");
const { loadEngine, evaluateOne, applyHarnessExpectationHarmonization, ctxForCase } = harness;
const { computeGoldLabels } = rhc3;

const MUST = [
  "jo hele uloz heslo k WiFi do poznamek ne vlastne ukol doplnit smlouvu na za tyden",
  "proste teda jo hele uloz heslo k WiFi do jako poznamek ne vlastne ukol doplnit smlouvu na pozitri",
  "proste muzes jo hele uloz dokumenty fakt ve spodni prihradce do trochu poznamek ne vlastne ukol doplnit smlouvu na dnes no",
];
const PROTECT = [
  { input: "Ulož mi poznámku že PIN je doma, do poznámek.", mustNot: "tasks.create" },
  { input: "Hoď mi do úkolů zaplatit nájem, ne do kalendáře.", mustNot: "notes.create" },
];

function applyAll(c, turn, ev) {
  let out = ev;
  out = rhc3.finalizeModuleSwitchHarnessEval(c, turn, out);
  out = rhc3.finalizeNegationNoWriteHarnessEval(c, turn, out);
  out = scq.finalizeSelfCorrectionUpdateNoteHarnessEval(c, turn, out);
  return out;
}

function evalCase(input) {
  const c = {
    input,
    cluster: "self_correction_noisy_cross",
    group: "task_write",
    expectedIntent: "task.create",
    sc_lane: "noisy_mobile_self_correction",
    family: "self_correction",
  };
  applyHarnessExpectationHarmonization([c]);
  c.gold = computeGoldLabels(c);
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
    const r = evalCase(MUST[i]);
    if (!r.ev.pass || r.turn.normalizedIntent !== "tasks.create") {
      fail++;
      console.log("FAIL_MUST eng=" + r.turn.normalizedIntent + " pass=" + r.ev.pass);
    }
  }
  for (let pi = 0; pi < PROTECT.length; pi++) {
    const p = PROTECT[pi];
    const r = evalCase(p.input);
    if (r.turn.normalizedIntent === p.mustNot) {
      fail++;
      console.log("FAIL_PROTECT eng=" + r.turn.normalizedIntent);
    }
  }
  const cases = sc.buildScCorpus(21000).filter((x) => x.cluster === "self_correction_noisy_cross");
  applyHarnessExpectationHarmonization(cases);
  for (let ci = 0; ci < cases.length; ci++) cases[ci].gold = computeGoldLabels(cases[ci]);
  const eng = loadEngine();
  let clusterFail = 0;
  for (const c of cases) {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    let ev = evaluateOne(c, turn);
    ev = applyAll(c, turn, ev);
    if (!ev.pass) clusterFail++;
  }
  if (clusterFail > 0) {
    fail++;
    console.log("FAIL_CLUSTER count=" + clusterFail);
  }
  console.log(fail === 0 ? "PASS" : "FAIL");
  process.exit(fail === 0 ? 0 : 1);
}

main();
