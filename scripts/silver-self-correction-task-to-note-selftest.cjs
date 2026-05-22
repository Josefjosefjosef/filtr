/**
 * P0 selftest: self_correction_module_task_to_note engine + harness.
 * Usage: node scripts/silver-self-correction-task-to-note-selftest.cjs
 */
/* eslint-disable no-console */
const sc = require("./silver-self-correction-audit.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, applyHarnessExpectationHarmonization, ctxForCase } = harness;
const {
  computeGoldLabels,
  finalizeModuleSwitchHarnessEval,
  finalizeModuleSwitchClarifyLaneHarnessEval,
  finalizeModuleSwitchTaskToNoteHarnessEval,
  finalizeModuleSwitchNegJakoCalToNoteHarnessEval,
} = rhc3;

const MUST = [
  "Hoď mi do úkolů zaplatit nájem, ne do kalendáře, do poznámek že číslo smlouvy.",
  "Hod mi do ukolu koupit mliko, ne do kalendare, do poznamek ze PIN ke karte.",
  "ee Hoď mi do úkolů poslat dokumenty, ne do trochu kalendáře, do poznámek že PIN ke kartě.",
];
const PROTECT = [
  { input: "Přidej úkol zavolat právníkovi zítra, ne do kalendáře.", mustNot: "notes.create" },
  { input: "Ulož mi poznámku že PIN je doma, ale ne do kalendáře, do poznámek.", mustNot: "tasks.create" },
];

function evalCase(input) {
  const c = {
    input,
    cluster: "self_correction_module_task_to_note",
    group: "note_write",
    expectedIntent: "note.create",
    sc_lane: "correction_module_switch",
    family: "module_switching",
  };
  applyHarnessExpectationHarmonization([c]);
  c.gold = computeGoldLabels(c);
  c.expectedIntent = c.gold.expected_intent;
  const eng = loadEngine();
  if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
  let ev = evaluateOne(c, turn);
  ev = finalizeModuleSwitchHarnessEval(c, turn, ev);
  ev = finalizeModuleSwitchClarifyLaneHarnessEval(c, turn, ev);
  ev = finalizeModuleSwitchTaskToNoteHarnessEval(c, turn, ev);
  ev = finalizeModuleSwitchNegJakoCalToNoteHarnessEval(c, turn, ev);
  return { turn, ev };
}

function main() {
  let fail = 0;
  for (let i = 0; i < MUST.length; i++) {
    const r = evalCase(MUST[i]);
    if (!r.ev.pass || r.turn.normalizedIntent !== "notes.create") {
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
  const cases = sc.buildScCorpus(3000).filter((x) => x.cluster === "self_correction_module_task_to_note");
  applyHarnessExpectationHarmonization(cases);
  for (let ci = 0; ci < cases.length; ci++) cases[ci].gold = computeGoldLabels(cases[ci]);
  const eng = loadEngine();
  let clusterFail = 0;
  for (const c of cases) {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    let ev = evaluateOne(c, turn);
    ev = finalizeModuleSwitchHarnessEval(c, turn, ev);
    ev = finalizeModuleSwitchClarifyLaneHarnessEval(c, turn, ev);
    ev = finalizeModuleSwitchTaskToNoteHarnessEval(c, turn, ev);
    ev = finalizeModuleSwitchNegJakoCalToNoteHarnessEval(c, turn, ev);
    if (!ev.pass) clusterFail++;
  }
  console.log("silver_self_correction_task_to_note_selftest_fail=" + (fail + clusterFail));
  console.log("cluster_cases=" + cases.length);
  console.log("cluster_fail=" + clusterFail);
  process.exit(fail + clusterFail > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}
