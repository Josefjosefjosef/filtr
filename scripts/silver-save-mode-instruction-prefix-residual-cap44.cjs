/**
 * SILVER_CAP44_INSTRUCTION_PREFIX_RESIDUAL_ONLY — narrow title cleanup orchestrator.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-save-mode-instruction-prefix-residual-cap44-report.json");
const CAP_REQUESTED = 44;
const MAIN_BEFORE = process.env.CAP44_MAIN_BEFORE || "90359bb0c8f1c3c5a9ebfe655e73ff7aef078c03";

const validator = require("./silver-clean-payload-validator-v1.cjs");
const actionCore = require("./silver-action-mode-v1-core.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const PRODUCT_PROBES = [
  {
    id: "A",
    input:
      "Hele Silver prosím tě já teď řídím takže jen rychle — zejtra kolem půl desátý doktor Praha 4 a napiš tam že mám vzít výsledky krve a kartičku pojišťovny",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "doktor", titleLacks: ["hele", "silver", "prosim", "ridim", "rychle"] },
  },
  {
    id: "B",
    input:
      "Silvere přidej mi úkol že mám do konce týdne zavolat instalatérovi kvůli koupelně a zeptat se na cenu",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "instalat", titleLacks: ["silvere", "pridej", "ukol", "ze mam"] },
  },
  {
    id: "C",
    input:
      "Ahoj Silver ulož mi někam že náhradní klíče od sklepa jsou v horním šuplíku u mámy",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "klíč", bodyLacks: ["ahoj", "silver", "uloz", "nejak"] },
  },
  {
    id: "D",
    input:
      "Silver dej mi do kalendáře příští pátek ve dvě schůzku s účetní v Brně a napiš tam že vytisknout faktury",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "účetní", titleLacks: ["silver", "dej", "kalend"] },
  },
  {
    id: "E",
    input: "Prosím tě Silver zejtra ve 12 oběd s Pavlem u Anděla a napiš tam že vzít smlouvu",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "oběd", titleLacks: ["silver", "prosim"] },
  },
  {
    id: "F",
    input:
      "Hele Silvere připomeň mi zejtra odpoledne koupit mamce kytku a ještě tam dej že se mám stavit v lékárně",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "kytku", titleLacks: ["hele", "silvere", "pripomen"] },
  },
  {
    id: "G",
    input:
      "Ahoj Silver zítra ráno technik kvůli internetu Praha 6 a napiš mi tam že připravit router a přístup do sklepa",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "technik", titleLacks: ["ahoj", "silver"] },
  },
  {
    id: "H",
    input:
      "Silver vlož mi prosím tě do kalendáře že příští týden ve středu v 9 ráno má přijít instalatér",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "instalat", titleLacks: ["silver", "vloz", "prosim", "kalend", "ze"] },
  },
  {
    id: "I",
    input: "Silvere prosím tě dej mi tam schůzku s panem Novotným zítra v 15 v Brně",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "novotn", titleLacks: ["silvere", "prosim", "dej mi tam"] },
  },
  {
    id: "J",
    input: "Hele Silver hoď mi do úkolů zavolat právníkovi během týdne kvůli smlouvě",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "právn", titleLacks: ["hele", "silver", "hod", "ukol"] },
  },
];

const GATE_SCRIPTS = [
  "silver-save-mode-reality-test-v1.cjs",
  "audit_silver_20000_routing_stable.cjs",
  "silver-save-mode-final-polish-cap40.cjs",
  "silver-save-understanding-validator-repair-cap30.cjs",
  "silver-clean-save-payload-production-line-v2.cjs",
];

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function lacksAll(hay, needles) {
  const h = foldCs(hay);
  for (let i = 0; i < needles.length; i++) {
    if (h.indexOf(foldCs(needles[i])) >= 0) return false;
  }
  return true;
}

function runProbes(eng) {
  const results = [];
  let pass = 0;
  for (let i = 0; i < PRODUCT_PROBES.length; i++) {
    const p = PRODUCT_PROBES[i];
    const turn = eng.processUserTurn(p.input, eng.createEmptyDraft(), ctxForCase(p.group));
    const title = validator.draftField(turn, "title");
    const body = validator.draftField(turn, "body");
    const ch = p.checks || {};
    let ok = String(turn.normalizedIntent || "") === p.intent;
    if (ch.titleHas && foldCs(title).indexOf(foldCs(ch.titleHas)) < 0) ok = false;
    if (ch.bodyHas && foldCs(body).indexOf(foldCs(ch.bodyHas)) < 0) ok = false;
    if (ch.titleLacks && !lacksAll(title, ch.titleLacks)) ok = false;
    if (ch.bodyLacks && !lacksAll(body, ch.bodyLacks)) ok = false;
    const modeVal = actionCore.validateSaveSearchTurn(turn, p.input);
    if (!modeVal.pass || modeVal.mode !== "save") ok = false;
    if (ok) pass++;
    results.push({ id: p.id, pass: ok, intent: turn.normalizedIntent, title, body });
  }
  return { results, pass, total: PRODUCT_PROBES.length };
}

function loadRealityMetrics() {
  const p = path.join(__dirname, "silver-save-mode-reality-test-v1-report.json");
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      cases_total: j.cases_total,
      overall_save_accuracy: j.overall_save_accuracy,
      payload_clean_rate: j.payload_clean_rate,
      semantic_slot_accuracy: j.semantic_slot_accuracy,
      assistant_name_in_title: j.title_contains_assistant_name_count,
      instruction_prefix_in_title: j.instruction_prefix_in_title_count,
      raw_command_stored_as_title: j.raw_command_stored_as_title_count,
      location_contains_note_or_filler: j.location_contains_note_or_filler_count,
    };
  } catch {
    return null;
  }
}

function parse20k(stdout) {
  const m = {};
  const pick = (re) => {
    const x = stdout.match(re);
    return x ? x[1] : "";
  };
  m.overall = pick(/overall_accuracy=(\d+\.?\d*)%/);
  m.calendar_write = pick(/calendar_write=(\d+\/\d+)/);
  m.calendar_query = pick(/calendar_query=(\d+\/\d+)/);
  m.task_write = pick(/task_write=(\d+\/\d+)/);
  m.task_query = pick(/task_query=(\d+\/\d+)/);
  m.note_write = pick(/note_write=(\d+\/\d+)/);
  m.note_query = pick(/note_query=(\d+\/\d+)/);
  m.dangerous_write = pick(/dangerous_write_count=(\d+)/);
  m.false_write = pick(/false_write_count=(\d+)/);
  m.query_created_write = pick(/query_created_write_count=(\d+)/);
  m.write_when_negated = pick(/write_when_negated_count=(\d+)/);
  m.create_without_card = pick(/create_without_card_count=(\d+)/);
  m.query_with_draft_card = pick(/query_with_draft_card_count=(\d+)/);
  return m;
}

function runGateScript(name) {
  const p = path.join(__dirname, name);
  if (!fs.existsSync(p)) return { script: name, status: "script_missing", stdout: "" };
  try {
    const env = Object.assign({}, process.env, { REALITY_SKIP_GATES: "1" });
    const stdout = execSync('node "' + p + '"', {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 900000,
      env,
    });
    return { script: name, status: "PASS", stdout };
  } catch (e) {
    return {
      script: name,
      status: "FAIL",
      stdout: String(e.stdout || ""),
      detail: String((e.stderr || e.message || "").slice(0, 300)),
    };
  }
}

function verdict(after, before, lowerIsBetter) {
  if (after < before && lowerIsBetter) return "IMPROVED";
  if (after > before && lowerIsBetter) return "REGRESSED";
  if (after > before && !lowerIsBetter) return "IMPROVED";
  if (after < before && !lowerIsBetter) return "REGRESSED";
  return "NO_CHANGE";
}

function main() {
  const eng = loadEngine();
  const probes = runProbes(eng);
  const gates = GATE_SCRIPTS.map(runGateScript);
  const reality = loadRealityMetrics();
  const r20 = gates.find((g) => g.script === "audit_silver_20000_routing_stable.cjs");
  const k20 = r20 && r20.stdout ? parse20k(r20.stdout) : {};

  const assistantBefore = 737;
  const instructionBefore = 425;
  const rawBefore = 55;
  const overallBefore = 0.6572;
  const payloadBefore = 0.9696;
  const semanticBefore = 0.6685;

  const assistantAfter = reality ? reality.assistant_name_in_title : 9999;
  const instructionAfter = reality ? reality.instruction_prefix_in_title : 9999;
  const rawAfter = reality ? reality.raw_command_stored_as_title : 9999;
  const overallAfter = reality ? reality.overall_save_accuracy : 0;
  const payloadAfter = reality ? reality.payload_clean_rate : 0;
  const semanticAfter = reality ? reality.semantic_slot_accuracy : 0;

  const stopFail =
    assistantAfter >= assistantBefore ||
    instructionAfter >= instructionBefore ||
    assistantAfter >= 500 ||
    instructionAfter >= 250 ||
    rawAfter > rawBefore ||
    overallAfter < overallBefore - 0.0001 ||
    payloadAfter < payloadBefore - 0.0001 ||
    semanticAfter < semanticBefore - 0.0001 ||
    k20.dangerous_write !== "0" ||
    k20.false_write !== "0" ||
    k20.query_created_write !== "0" ||
    k20.write_when_negated !== "0" ||
    k20.create_without_card !== "0" ||
    k20.query_with_draft_card !== "0" ||
    k20.overall !== "100" ||
    probes.pass !== probes.total ||
    gates.some((g) => g.status !== "PASS");

  const report = {
    cap_requested: CAP_REQUESTED,
    cap_completed: stopFail ? 44 : 44,
    cap_stop_reason: stopFail ? "STOP_gate_failed" : "",
    main_commit_before: MAIN_BEFORE,
    main_commit_after: mainCommit(),
    product_probes: probes,
    reality,
    gates,
    routing_20k: k20,
    pass_fail: stopFail ? "FAIL" : "PASS",
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_CAP44_INSTRUCTION_PREFIX_RESIDUAL_ONLY ===");
  console.log("main_commit_before=" + MAIN_BEFORE);
  console.log("main_commit_after=" + report.main_commit_after);
  console.log("cap_completed=44");
  console.log("cap_stop_reason=" + (stopFail ? "STOP_gate_failed" : ""));
  console.log("assistant_name_in_title_before=" + assistantBefore);
  console.log("assistant_name_in_title_after=" + assistantAfter);
  console.log("instruction_prefix_in_title_before=" + instructionBefore);
  console.log("instruction_prefix_in_title_after=" + instructionAfter);
  console.log("raw_command_stored_as_title_before=" + rawBefore);
  console.log("raw_command_stored_as_title_after=" + rawAfter);
  console.log("overall_save_accuracy_before=" + (overallBefore * 100).toFixed(2) + "%");
  console.log("overall_save_accuracy_after=" + (overallAfter * 100).toFixed(2) + "%");
  console.log("product_probes_A_to_J_pass=" + probes.pass + "/" + probes.total);
  console.log("20k_overall_accuracy=" + (k20.overall || "?") + "%");
  console.log("PASS_FAIL=" + report.pass_fail);
  console.log("=== END_SILVER_CAP44_INSTRUCTION_PREFIX_RESIDUAL_ONLY ===");

  if (stopFail) process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { main };
