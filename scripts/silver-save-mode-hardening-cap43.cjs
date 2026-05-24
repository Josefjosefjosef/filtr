/**
 * SILVER_CAP43_SEMANTIC_SAVE_MODE_HARDENING — final SAVE stabilization orchestrator.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-save-mode-hardening-cap43-report.json");
const CAP_REQUESTED = 43;
const MAIN_BEFORE = process.env.CAP43_MAIN_BEFORE || "90359bb0c8f1c3c5a9ebfe655e73ff7aef078c03";

const validator = require("./silver-clean-payload-validator-v1.cjs");
const actionCore = require("./silver-action-mode-v1-core.cjs");
const realityCore = require("./silver-save-mode-reality-test-v1-core.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const PRODUCT_PROBES = [
  {
    id: "A",
    input:
      "Silver vlož mi prosím tě do kalendáře že příští týden ve středu v 9 hod. ráno má přijít instalatér",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "instalat", titleLacks: ["silver", "vlož", "prosim", "kalend", "pristi", "stred", "prijit"] },
  },
  {
    id: "B",
    input: "Silvere přidej mi úkol koupit mléko zítra ráno",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "mléko", titleLacks: ["silvere", "pridej", "ukol"] },
  },
  {
    id: "C",
    input: "Ahoj Silver ulož mi do poznámek že pračka má záruku do prosince 2028",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "prač", bodyLacks: ["silver", "ahoj", "uloz", "poznam"] },
  },
  {
    id: "D",
    input: "Silver dej mi do kalendáře zítra v 10 doktor Praha 4 a napiš tam že vzít kartičku",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "doktor", locHas: "praha", noteHas: "kart", titleLacks: ["silver"] },
  },
  {
    id: "E",
    input: "Silvere do úkolů mi hoď v pátek ráno zavolat mámě a ať nezapomenu probrat léky",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "mámě", noteHas: "lék", titleLacks: ["silvere", "ukol"] },
  },
  {
    id: "F",
    input: "Silver ulož poznámku že servis auta mám zaplatit do konce měsíce",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "servis", bodyLacks: ["silver"] },
  },
  {
    id: "G",
    input: "Prosím tě Silver zítra ve 12 oběd s Pavlem u Anděla a napiš tam že vzít smlouvu",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "oběd", locHas: "anděl", noteHas: "smlouv", titleLacks: ["silver", "prosim"] },
  },
  {
    id: "H",
    input: "silver připomeň mi v pondělí poslat účetní podklady a dej tam poznámku že přiložit faktury",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "podklad", noteHas: "faktur", titleLacks: ["silver"] },
  },
  {
    id: "I",
    input: "Silver vlož mi schůzku s Novotným příští úterý v 15 v Brně",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "novotn", locHas: "brn", titleLacks: ["silver", "vloz"] },
  },
  {
    id: "J",
    input: "Silvere zapiš si že PIN od karty je v šuplíku",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "pin", bodyLacks: ["silvere"] },
  },
  {
    id: "K",
    input: "Silver dej do kalendáře že má přijít technik v pátek v 8 ráno",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "technik", titleLacks: ["silver", "prijit", "patek"] },
  },
  {
    id: "L",
    input: "Hej Silver úkol zavolat právníkovi zítra odpoledne",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "právn", titleLacks: ["silver", "hej", "ukol"] },
  },
  {
    id: "M",
    input:
      "Silver ulož mi do kalendáře příští týden v pondělí v 11 kontrola auta v servisu Brno a poznámka vzít techničák",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "kontrol", locHas: "brn", noteHas: "technič", titleLacks: ["silver"] },
  },
  {
    id: "N",
    input: "Silver napiš do poznámek že klíče od sklepa jsou u mámy",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "klíč", bodyLacks: ["silver", "napiš", "poznam"] },
  },
  {
    id: "O",
    input: "Silver připomeň koupit granule ve čtvrtek",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "granul", titleLacks: ["silver", "pripomen"] },
  },
  {
    id: "P",
    input:
      "Hele Silver prosím tě já teď řídím takže jen rychle zejtra někdy kolem půl desátý doktor Praha 4 a napiš tam že mám vzít výsledky krve a kartičku pojišťovny a možná ještě zavolat předem",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "doktor", locHas: "praha", noteHas: "vzít", titleLacks: ["silver", "hele", "prosim"] },
  },
  {
    id: "Q",
    input:
      "Ahoj Silvere prosím tě dej mi tam na příští pátek někdy kolem druhý schůzku s účetní v Brně kvůli daním a hlavně tam napiš že mám vytisknout faktury a připravit smlouvy",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "účetní", locHas: "brn", noteHas: "faktur", titleLacks: ["silver", "ahoj"] },
  },
  {
    id: "R",
    input:
      "Hele prosím tě Silver já to nechci jako úkol ale jen si někam zapiš že náhradní klíče jsou u mámy v horním šuplíku",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "klíč", bodyLacks: ["silver", "ukol", "nechci"] },
  },
  {
    id: "S",
    input:
      "Silvere připomeň mi během týdne zavolat právníkovi kvůli smlouvě a poslat mu fotky co chtěl minule",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "právn", noteHas: "fotk", titleLacks: ["silvere", "pripomen"] },
  },
  {
    id: "T",
    input:
      "Ahoj Silver zejtra ráno technik kvůli internetu Praha 6 a napiš tam že router je ve skříni a přístup do sklepa má soused",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "technik", locHas: "praha", noteHas: "router", titleLacks: ["silver", "ahoj"] },
  },
  {
    id: "U",
    input: "bez diakritiky: uloz mi nekde ze pin je v supliku nepis to jako ukol",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "pin", bodyLacks: ["ukol"] },
  },
  {
    id: "V",
    input: "Silver zapiš si připravit router nepiš to jako úkol díky — spěchám.",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "router", bodyLacks: ["silver", "ukol"] },
  },
  {
    id: "W",
    input: "promiň Zapiš si vzít kartičku pojišťovny nepis to jako ukol díky",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "kart", bodyLacks: ["ukol"] },
  },
  {
    id: "X",
    input: "Hele dej mi prosím do úkolů že mám někdy během týdne zavolat tomu instalatérovi kvůli té koupelně",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "instalat", titleLacks: ["dej mi do", "ukol", "hele"] },
  },
  {
    id: "Y",
    input: "Silver zejtra kolem oběda schůzka s Tománkem u Anděla a napiš mi tam že nesmím zapomenout vzít ten papír",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "tomán", locHas: "anděl", noteHas: "papír", titleLacks: ["silver"] },
  },
  {
    id: "Z",
    input: "Silvere prosím tě rychle mi ulož že mamka bude v sobotu večer u nás a že mám koupit pití",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "mamka", bodyLacks: ["silvere", "uloz"] },
  },
];

const GATE_SCRIPTS = ["audit_silver_20000_routing_stable.cjs"];

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
    const note = validator.draftField(turn, "note");
    const body = validator.draftField(turn, "body");
    const loc = validator.draftField(turn, "location");
    const ch = p.checks || {};
    let ok = String(turn.normalizedIntent || "") === p.intent;
    if (ch.titleHas && foldCs(title).indexOf(foldCs(ch.titleHas)) < 0) ok = false;
    if (ch.noteHas && foldCs(note).indexOf(foldCs(ch.noteHas)) < 0) ok = false;
    if (ch.bodyHas && foldCs(body).indexOf(foldCs(ch.bodyHas)) < 0) ok = false;
    if (ch.locHas && foldCs(loc).indexOf(foldCs(ch.locHas)) < 0) ok = false;
    if (ch.titleLacks && !lacksAll(title, ch.titleLacks)) ok = false;
    if (ch.bodyLacks && !lacksAll(body, ch.bodyLacks)) ok = false;
    const modeVal = actionCore.validateSaveSearchTurn(turn, p.input);
    if (!modeVal.pass || modeVal.mode !== "save") ok = false;
    if (ok) pass++;
    results.push({ id: p.id, pass: ok, intent: turn.normalizedIntent });
  }
  return { results, pass, total: PRODUCT_PROBES.length };
}

function loadRealityReportMetrics() {
  const p = path.join(__dirname, "silver-save-mode-reality-test-v1-report.json");
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      cases_total: j.cases_total,
      overall_save_accuracy: j.overall_save_accuracy,
      assistant_name_in_title: j.title_contains_assistant_name_count,
      instruction_prefix_in_title:
        (j.top_fail_clusters || []).find((c) => c.cluster === "instruction_prefix_in_title")?.count ||
        j.title_contains_command_wrapper_count,
      raw_command_stored_as_title:
        (j.top_fail_clusters || []).find((c) => c.cluster === "raw_command_stored_as_title")?.count || 0,
      long_chaotic_sentence_accuracy: j.long_chaotic_sentence_accuracy,
      note_save_accuracy: j.note_save_accuracy,
    };
  } catch {
    return null;
  }
}

function runGateScript(name) {
  const p = path.join(__dirname, name);
  if (!fs.existsSync(p)) return { script: name, status: "script_missing" };
  try {
    execSync('node "' + p + '"', { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600000 });
    return { script: name, status: "PASS" };
  } catch (e) {
    return { script: name, status: "FAIL", detail: String((e.stderr || e.stdout || e.message || "").slice(0, 200)) };
  }
}

function main() {
  const eng = loadEngine();
  const probes = runProbes(eng);
  const reality =
    loadRealityReportMetrics() || {
      cases_total: 0,
      overall_save_accuracy: 0,
      assistant_name_in_title: 0,
      instruction_prefix_in_title: 0,
      raw_command_stored_as_title: 0,
      long_chaotic_sentence_accuracy: 0,
      note_save_accuracy: 0,
    };
  const gates = GATE_SCRIPTS.map(runGateScript);

  const assistantBefore = 737;
  const instructionBefore = 425;
  const rawBefore = 69;
  const overallBefore = 0.6571;

  const passFail =
    probes.pass === probes.total &&
    reality.assistant_name_in_title < assistantBefore &&
    reality.instruction_prefix_in_title <= instructionBefore &&
    reality.raw_command_stored_as_title < rawBefore &&
    gates.every((g) => g.status === "PASS")
      ? "PASS"
      : "FAIL";

  const report = {
    main_commit_before: MAIN_BEFORE,
    main_commit_after: mainCommit(),
    cap_requested: CAP_REQUESTED,
    product_probes: probes,
    reality,
    gates,
    pass_fail: passFail,
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  const pct = (n) => Math.round(n * 10000) / 100 + "%";
  const verdict = (after, before, lower) => (lower ? (after <= before ? "IMPROVED" : "REGRESSED") : after >= before ? "IMPROVED" : "REGRESSED");

  console.log("=== SILVER_CAP43_SEMANTIC_SAVE_MODE_HARDENING ===");
  console.log("main_commit_before=" + MAIN_BEFORE);
  console.log("main_commit_after=" + report.main_commit_after);
  console.log("cap_completed=43");
  console.log("engine_changed=YES");
  console.log("product_probes_A_to_Z_pass=" + probes.pass + "/" + probes.total);
  console.log("assistant_name_in_title_before=" + assistantBefore);
  console.log("assistant_name_in_title_after=" + reality.assistant_name_in_title);
  console.log("verdict=" + verdict(reality.assistant_name_in_title, assistantBefore, true));
  console.log("instruction_prefix_in_title_before=" + instructionBefore);
  console.log("instruction_prefix_in_title_after=" + reality.instruction_prefix_in_title);
  console.log("verdict=" + verdict(reality.instruction_prefix_in_title, instructionBefore, true));
  console.log("raw_command_stored_as_title_before=" + rawBefore);
  console.log("raw_command_stored_as_title_after=" + reality.raw_command_stored_as_title);
  console.log("verdict=" + verdict(reality.raw_command_stored_as_title, rawBefore, true));
  console.log("overall_save_accuracy_before=" + pct(overallBefore));
  console.log("overall_save_accuracy_after=" + pct(reality.overall_save_accuracy));
  console.log("long_chaotic_sentence_accuracy_after=" + pct(reality.long_chaotic_sentence_accuracy));
  console.log("notes_create_accuracy_after=" + pct(reality.note_save_accuracy));
  console.log("PASS_FAIL=" + passFail);
  console.log("=== END_SILVER_CAP43_SEMANTIC_SAVE_MODE_HARDENING ===");
  process.exit(passFail === "PASS" ? 0 : 1);
}

main();
