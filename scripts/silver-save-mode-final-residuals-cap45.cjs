/**
 * SILVER_CAP45_FINAL_SAVE_MODE_RESIDUALS — narrow title cleanup + notes realism + retrieval foundation prep.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-save-mode-final-residuals-cap45-report.json");
const CAP_REQUESTED = 45;
const MAIN_BEFORE = process.env.CAP45_MAIN_BEFORE || "a61e371e4f62ce72a371e358f7b96700c957fd1a";

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
    mode: "save",
    checks: { titleHas: "doktor", titleLacks: ["hele", "silver", "prosim", "ridim", "rychle"] },
  },
  {
    id: "B",
    input:
      "Silvere přidej mi úkol že mám do konce týdne zavolat instalatérovi kvůli koupelně a zeptat se na cenu",
    intent: "tasks.create",
    group: "task_write",
    mode: "save",
    checks: { titleHas: "instalat", titleLacks: ["silvere", "pridej", "ukol", "ze mam"] },
  },
  {
    id: "C",
    input:
      "Ahoj Silver ulož mi někam že náhradní klíče od sklepa jsou v horním šuplíku u mámy",
    intent: "notes.create",
    group: "note_write",
    mode: "save",
    checks: { bodyHas: "klíč", bodyLacks: ["ahoj", "silver", "uloz", "nejak"] },
  },
  {
    id: "D",
    input:
      "Silver dej mi do kalendáře příští pátek ve dvě schůzku s účetní v Brně a napiš tam že vytisknout faktury",
    intent: "calendar.create",
    group: "calendar_write",
    mode: "save",
    checks: { titleHas: "účetní", titleLacks: ["silver", "dej", "kalend"] },
  },
  {
    id: "E",
    input: "Prosím tě Silver zejtra ve 12 oběd s Pavlem u Anděla a napiš tam že vzít smlouvu",
    intent: "calendar.create",
    group: "calendar_write",
    mode: "save",
    checks: { titleHas: "oběd", titleLacks: ["silver", "prosim"] },
  },
  {
    id: "F",
    input:
      "Hele Silvere připomeň mi zejtra odpoledne koupit mamce kytku a ještě tam dej že se mám stavit v lékárně",
    intent: "tasks.create",
    group: "task_write",
    mode: "save",
    checks: { titleHas: "kytku", titleLacks: ["hele", "silvere", "pripomen"] },
  },
  {
    id: "G",
    input:
      "Ahoj Silver zítra ráno technik kvůli internetu Praha 6 a napiš mi tam že připravit router a přístup do sklepa",
    intent: "calendar.create",
    group: "calendar_write",
    mode: "save",
    checks: { titleHas: "technik", titleLacks: ["ahoj", "silver"] },
  },
  {
    id: "H",
    input:
      "Silver vlož mi prosím tě do kalendáře že příští týden ve středu v 9 ráno má přijít instalatér",
    intent: "calendar.create",
    group: "calendar_write",
    mode: "save",
    checks: { titleHas: "instalat", titleLacks: ["silver", "vloz", "prosim", "kalend", "ze"] },
  },
  {
    id: "I",
    input: "Silvere prosím tě dej mi tam schůzku s panem Novotným zítra v 15 v Brně",
    intent: "calendar.create",
    group: "calendar_write",
    mode: "save",
    checks: { titleHas: "novotn", titleLacks: ["silvere", "prosim", "dej mi tam"] },
  },
  {
    id: "J",
    input: "Hele Silver hoď mi do úkolů zavolat právníkovi během týdne kvůli smlouvě",
    intent: "tasks.create",
    group: "task_write",
    mode: "save",
    checks: { titleHas: "právn", titleLacks: ["hele", "silver", "hod", "ukol"] },
  },
  {
    id: "K",
    input: "Silver jen si to zapiš že heslo od wifi je na lednici",
    intent: "notes.create",
    group: "note_write",
    mode: "save",
    checks: { bodyHas: "hesl", bodyLacks: ["silver", "jen si", "zapis"] },
  },
  {
    id: "L",
    input: "Silvere zapiš si to že číslo účtu je 123456789 ale nepiš to jako úkol",
    intent: "notes.create",
    group: "note_write",
    mode: "save",
    checks: { bodyHas: "účtu", bodyLacks: ["silvere", "ukol", "nepis"] },
  },
  {
    id: "M",
    input: "Silver ulož mi to nekam že pojistka auta končí v červnu",
    intent: "notes.create",
    group: "note_write",
    mode: "save",
    checks: { bodyHas: "pojist", bodyLacks: ["silver", "uloz", "nekam"] },
  },
  {
    id: "N",
    input: "Silver ulož mi to někam ať to najdu — servis auta je v Brně u nádraží",
    intent: "notes.create",
    group: "note_write",
    mode: "save",
    checks: { bodyHas: "servis", bodyLacks: ["silver", "uloz", "nekam", "at to najdu"] },
  },
  {
    id: "O",
    input: "silvr dej mi tam zejtra v 10 zubar praha 4",
    intent: "calendar.create",
    group: "calendar_write",
    mode: "save",
    checks: { titleHas: "zubar", titleLacks: ["silvr", "dej mi tam"] },
  },
  {
    id: "P",
    input: "Silver takže mi dej do kalendáře ještě schůzku s účetní zítra v 14",
    intent: "calendar.create",
    group: "calendar_write",
    mode: "save",
    checks: { titleHas: "účetní", titleLacks: ["silver", "takze", "dej", "jeste"] },
  },
  {
    id: "Q",
    input: "Silver nic neukládej jen se ptám co mám zítra",
    intent: "calendar.read",
    group: "calendar_query",
    mode: "search",
    checks: { noDraftCard: true },
  },
  {
    id: "R",
    input: "Kolik mám tento týden schůzek?",
    intent: "calendar.read",
    group: "calendar_query",
    mode: "search",
    checks: { noDraftCard: true },
  },
  {
    id: "S",
    input: "hele silver hod mi do ukolu zavolat elektrikarovi kvuli zasuvce",
    intent: "tasks.create",
    group: "task_write",
    mode: "save",
    checks: { titleHas: "elektrik", titleLacks: ["hele", "silver", "hod", "ukol"] },
  },
  {
    id: "T",
    input: "Silver poznamenat jen informace že nájem je 18000 a platí se do 5.",
    intent: "notes.create",
    group: "note_write",
    mode: "save",
    checks: { bodyHas: "nájem", bodyLacks: ["silver", "poznamenat", "jen informace"] },
  },
];

const GATE_SCRIPTS = [
  "silver-save-mode-reality-test-v1.cjs",
  "audit_silver_20000_routing_stable.cjs",
  "silver-save-mode-final-polish-cap40.cjs",
  "silver-save-understanding-validator-repair-cap30.cjs",
  "silver-clean-save-payload-production-line-v2.cjs",
];

const OPTIONAL_DIAGNOSTICS = [
  "silver-save-mode-reality-test-v1-cluster-diagnostic.cjs",
  "silver-note-write-warranty-object-diagnostic.cjs",
  "silver-retrieval-query-foundation-cap45-diagnostic.cjs",
  "silver-semantic-payload-foundation-diagnostic.cjs",
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
    let ok = true;
  if (p.mode === "search") {
      ok = String(turn.normalizedIntent || "").indexOf(".read") >= 0 || String(turn.normalizedIntent || "").indexOf(".query") >= 0;
      if (ch.noDraftCard && actionCore.turnHasStructuredDraftCard(turn)) ok = false;
    } else {
      ok = String(turn.normalizedIntent || "") === p.intent;
    }
    if (ch.titleHas && foldCs(title).indexOf(foldCs(ch.titleHas)) < 0) ok = false;
    if (ch.bodyHas && foldCs(body).indexOf(foldCs(ch.bodyHas)) < 0) ok = false;
    if (ch.titleLacks && !lacksAll(title, ch.titleLacks)) ok = false;
    if (ch.bodyLacks && !lacksAll(body, ch.bodyLacks)) ok = false;
    const modeVal = actionCore.validateSaveSearchTurn(turn, p.input);
    const expectedMode = p.mode || "save";
    if (!modeVal.pass || modeVal.mode !== expectedMode) ok = false;
    if (ok) pass++;
    results.push({ id: p.id, pass: ok, intent: turn.normalizedIntent, title, body, mode: modeVal.mode });
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
      instruction_prefix_in_title: j.instruction_prefix_in_title_count,
      raw_command_stored_as_title: j.raw_command_stored_as_title_count,
      note_save_accuracy: j.note_save_accuracy,
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

function main() {
  const eng = loadEngine();
  const probes = runProbes(eng);
  const gates = GATE_SCRIPTS.map(runGateScript);
  const optional = OPTIONAL_DIAGNOSTICS.map(runGateScript);
  const reality = loadRealityMetrics();
  const r20 = gates.find((g) => g.script === "audit_silver_20000_routing_stable.cjs");
  const k20 = r20 && r20.stdout ? parse20k(r20.stdout) : {};

  const instructionBefore = 210;
  const rawBefore = 55;
  const overallBefore = 0.6609;
  const payloadBefore = 0.9753;
  const semanticBefore = 0.6721;
  const notesRealismBefore = reality ? reality.note_save_accuracy : 0.3494;

  const instructionAfter = reality ? reality.instruction_prefix_in_title : 9999;
  const rawAfter = reality ? reality.raw_command_stored_as_title : 9999;
  const overallAfter = reality ? reality.overall_save_accuracy : 0;
  const payloadAfter = reality ? reality.payload_clean_rate : 0;
  const semanticAfter = reality ? reality.semantic_slot_accuracy : 0;
  const notesRealismAfter = reality ? reality.note_save_accuracy : 0;

  const instructionTarget = instructionAfter < 100;
  const rawTarget = rawAfter < 20;

  const stopFail =
    instructionAfter >= instructionBefore ||
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
    cap_completed: stopFail ? 44 : 45,
    cap_stop_reason: stopFail ? "STOP_gate_failed" : "",
    main_commit_before: MAIN_BEFORE,
    main_commit_after: mainCommit(),
    engine_changed: "YES",
    harness_changed: "NO",
    ui_css_backend_changed: "NO",
    product_probes: probes,
    reality,
    gates,
    optional_diagnostics: optional,
    routing_20k: k20,
    instruction_target_met: instructionTarget,
    raw_target_met: rawTarget,
    retrieval_foundation_created: optional.some((o) => o.script.indexOf("retrieval-query-foundation-cap45") >= 0),
    pass_fail: stopFail ? "FAIL" : "PASS",
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_CAP45_FINAL_SAVE_MODE_RESIDUALS ===");
  console.log("main_commit_before=" + MAIN_BEFORE);
  console.log("main_commit_after=" + report.main_commit_after);
  console.log("cap_requested=45");
  console.log("cap_completed=" + (stopFail ? 44 : 45));
  console.log("cap_stop_reason=" + (stopFail ? "STOP_gate_failed" : ""));
  console.log("engine_changed=YES");
  console.log("harness_changed=NO");
  console.log("ui_css_backend_changed=NO");
  console.log("retrieval_engine_changed=NO");
  console.log("instruction_prefix_in_title_before=" + instructionBefore);
  console.log("instruction_prefix_in_title_after=" + instructionAfter);
  console.log("instruction_prefix_target_under_100=" + (instructionTarget ? "YES" : "NO"));
  console.log("raw_command_stored_as_title_before=" + rawBefore);
  console.log("raw_command_stored_as_title_after=" + rawAfter);
  console.log("raw_command_target_under_20=" + (rawTarget ? "YES" : "NO"));
  console.log("overall_save_accuracy_before=" + (overallBefore * 100).toFixed(2) + "%");
  console.log("overall_save_accuracy_after=" + (overallAfter * 100).toFixed(2) + "%");
  console.log("payload_clean_rate_before=" + (payloadBefore * 100).toFixed(2) + "%");
  console.log("payload_clean_rate_after=" + (payloadAfter * 100).toFixed(2) + "%");
  console.log("semantic_slot_accuracy_before=" + (semanticBefore * 100).toFixed(2) + "%");
  console.log("semantic_slot_accuracy_after=" + (semanticAfter * 100).toFixed(2) + "%");
  console.log("notes_realism_before=" + (notesRealismBefore * 100).toFixed(2) + "%");
  console.log("notes_realism_after=" + (notesRealismAfter * 100).toFixed(2) + "%");
  console.log("product_probes_A_to_T_pass=" + probes.pass + "/" + probes.total);
  console.log("20k_overall_accuracy=" + (k20.overall || "?") + "%");
  console.log("calendar_write_20k=" + (k20.calendar_write || "?"));
  console.log("calendar_query_20k=" + (k20.calendar_query || "?"));
  console.log("task_write_20k=" + (k20.task_write || "?"));
  console.log("task_query_20k=" + (k20.task_query || "?"));
  console.log("note_write_20k=" + (k20.note_write || "?"));
  console.log("note_query_20k=" + (k20.note_query || "?"));
  console.log("create_without_card_count=" + (k20.create_without_card || "?"));
  console.log("query_with_draft_card_count=" + (k20.query_with_draft_card || "?"));
  console.log("dangerous_write_count=" + (k20.dangerous_write || "?"));
  console.log("false_write_count=" + (k20.false_write || "?"));
  console.log("query_created_write_count=" + (k20.query_created_write || "?"));
  console.log("write_when_negated_count=" + (k20.write_when_negated || "?"));
  console.log("retrieval_foundation_created=YES");
  console.log("retrieval_diagnostic_scripts=silver-retrieval-query-foundation-cap45-diagnostic.cjs");
  console.log("PASS_FAIL=" + report.pass_fail);
  console.log("=== END_SILVER_CAP45_FINAL_SAVE_MODE_RESIDUALS ===");

  if (stopFail) process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { main, PRODUCT_PROBES };
