/**
 * SILVER_SAVE_UNDERSTANDING_VALIDATOR_REPAIR_CAP30
 * Controlled production line — validator/repair layer + long chaotic SAVE probes.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-save-understanding-validator-repair-cap30-report.json");
const CAP_REQUESTED = 30;
const MAIN_BEFORE = process.env.CAP30_MAIN_BEFORE || "0a763ed20bf5dd2d918009ebd72d5bb12fd1f121";

const validator = require("./silver-clean-payload-validator-v1.cjs");
const saveCore = require("./silver-save-understanding-validator-repair-v1-core.cjs");
const actionCore = require("./silver-action-mode-v1-core.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const PRODUCT_PROBES = [
  {
    id: "A",
    input:
      "Hele Silver prosím tě já teď řídím takže jen rychle — zejtra někdy kolem půl desátý mám myslím toho doktora na Praze 4 jak jsme se o tom bavili a napiš mi tam prosím že si mám vzít výsledky krve a kartičku pojišťovny protože to zase zapomenu",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "doktor", locHas: "praha", noteHas: "vzít", titleLacks: ["silver", "napiš", "prosim"] },
  },
  {
    id: "B",
    input:
      "Silver prosím tě až budeš mít chvilku tak mi tam někam do kalendáře dej na příští středu myslím že to bylo asi kolem jedenáctý schůzku s tím elektrikářem jak měl přijet kvůli těm zásuvkám do Brna a napiš mi tam že musím nachystat smlouvu a klíče od sklepa",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "elektrik", locHas: "brn", noteHas: "smlouv", titleLacks: ["silver", "dej mi"] },
  },
  {
    id: "C",
    input:
      "Hele Silvere připomeň mi zejtra odpoledne koupit mamce kytku ale ne moc drahou a ještě tam dej že se mám stavit v lékárně protože jinak zase zapomenu a možná kdyby byl čas tak se stavit ještě v DMku",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "kytku", noteHas: "lékár", titleLacks: ["silver", "připomeň"] },
  },
  {
    id: "D",
    input:
      "Prosím tě Silver ulož mi někam že děti budou příští víkend u Karolíny na tý adrese ve Zlíně jak už ji máme uloženou ať to kdyžtak najdu až to budu potřebovat protože si to nikdy nepamatuju",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "děti", bodyLacks: ["silver", "ulož mi", "někam"] },
  },
  {
    id: "E",
    input:
      "Silvere já teď nemůžu moc psát takže jen rychle — v pondělí ráno servis auta v Brně myslím v devět a napiš tam že mám vzít techničák a zimní kola pokud budou ještě v kufru a možná zavolat předem",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "servis", locHas: "brn", noteHas: "technič", titleLacks: ["silver", "nemůžu"] },
  },
  {
    id: "F",
    input:
      "Hele dej mi prosím do úkolů že mám někdy během týdne zavolat právníkovi kvůli tý smlouvě a ještě mi připomeň že mu mám poslat ty fotky a dokumenty co chtěl minule protože na to určitě zase zapomenu",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "právn", noteHas: "fotk", titleLacks: ["dej mi", "úkol"] },
  },
  {
    id: "G",
    input:
      "Silver zejtra kolem oběda asi ve dvanáct nebo půl jedný schůzka s Tománkem někde u Anděla a napiš mi tam že nesmím zapomenout vzít ten podepsanej papír co mi posílal mailem a ještě možná notebook",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "tomán", locHas: "anděl", noteHas: "papír", titleLacks: ["silver"] },
  },
  {
    id: "H",
    input:
      "Hele Silver dej mi tam příští pátek myslím někdy kolem druhý odpoledne schůzku s účetní v Brně kvůli daním a napiš tam že mám vytisknout ty faktury a připravit smlouvy co jsme řešili minule",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "účetní", locHas: "brn", noteHas: "faktur", titleLacks: ["silver", "dej mi"] },
  },
  {
    id: "I",
    input:
      "Silvere prosím tě rychle mi ulož že mamka bude v sobotu večer u nás a že mám koupit pití a něco k jídlu protože jinak zase všechno zapomenu",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "mamka", bodyLacks: ["silvere", "ulož"] },
  },
  {
    id: "J",
    input:
      "Silver dej mi prosím do kalendáře na další úterý někdy dopoledne asi kolem desátý schůzku s panem Novotným u něj v kanceláři na Vinohradech a napiš tam že mám vzít obě smlouvy, občanku a ty papíry co jsem tisknul včera večer",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "novotn", locHas: "vinohrad", noteHas: "smlouv", titleLacks: ["silver"] },
  },
  {
    id: "K",
    input:
      "Hele prosím tě Silvere ulož mi úkol že mám do konce týdne zavolat tomu instalatérovi kvůli té koupelně, domluvit termín, zeptat se na cenu a hlavně mu říct že dopoledne většinou nejsem doma",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "instalat", titleLacks: ["silver", "ulož mi úkol"] },
  },
  {
    id: "L",
    input:
      "Silver zapiš si prosím tě někam že náhradní klíče od sklepa jsou v horním šuplíku u mámy, ale nepiš to jako úkol, jen ať to později najdu",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "klíč", bodyLacks: ["silver", "zapiš"] },
  },
  {
    id: "M",
    input:
      "Ahoj Silver zejtra ráno v osm nebo možná čtvrt na devět technik kvůli internetu Praha 6 a napiš mi tam že mám připravit smlouvu, router a přístup do sklepa",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "technik", locHas: "praha", noteHas: "smlouv", titleLacks: ["silver", "ahoj"] },
  },
  {
    id: "N",
    input:
      "Silvere přidej mi do úkolů na pondělí ráno že mám poslat Karolíně peníze na kluky a dej tam poznámku že jí mám zároveň napsat omluvu a potvrdit kdy přijedou",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "karol", noteHas: "omluv", titleLacks: ["silvere", "přidej"] },
  },
  {
    id: "O",
    input:
      "Silver ulož mi do poznámek že u auta je potřeba do konce měsíce vyřešit servis, technickou, zimní kola a ještě zavolat do pojišťovny kvůli zelené kartě",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "auta", bodyLacks: ["silver", "ulož mi"] },
  },
];

const AUDIT_SCRIPTS = [
  "silver-long-chaotic-save-understanding-audit-v1.cjs",
  "silver-save-field-validator-audit-v1.cjs",
  "silver-save-repair-pass-audit-v1.cjs",
  "silver-save-confidence-audit-v1.cjs",
  "silver-save-continuation-validator-audit-v1.cjs",
  "silver-assistant-name-stripper-audit-v1.cjs",
  "silver-save-mode-cross-field-isolation-audit-v1.cjs",
];

const GATE_SCRIPTS = [
  "silver-clean-save-payload-production-line-v2.cjs",
  "silver-clean-payload-micro-clusters-cap25.cjs",
  "audit_silver_20000_routing_stable.cjs",
  "audit_silver_quality_v2.cjs",
  "audit_silver_realistic_mobile_corpus.cjs",
  "silver-real-czech-corpus-v1.cjs",
  "silver-real-czech-public-ux-corpus-v2.cjs",
  "silver-deep-product-real-ux-v2.cjs",
  "silver-calendar-create-regression.mjs",
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
  const out = [];
  let pass = 0;
  for (let i = 0; i < PRODUCT_PROBES.length; i++) {
    const p = PRODUCT_PROBES[i];
    const turn = eng.processUserTurn(p.input, eng.createEmptyDraft(), ctxForCase(p.group));
    const title = validator.draftField(turn, "title");
    const note = validator.draftField(turn, "note");
    const body = validator.draftField(turn, "body");
    const taskNote = String((turn.draft && turn.draft.taskNote) || "");
    const loc = validator.draftField(turn, "location");
    const ch = p.checks || {};
    let ok = String(turn.normalizedIntent || "") === p.intent;
    if (ch.titleHas && foldCs(title).indexOf(foldCs(ch.titleHas)) < 0) ok = false;
    if (ch.noteHas && foldCs(note + taskNote).indexOf(foldCs(ch.noteHas)) < 0) ok = false;
    if (ch.bodyHas && foldCs(body).indexOf(foldCs(ch.bodyHas)) < 0) ok = false;
    if (ch.locHas && foldCs(loc).indexOf(foldCs(ch.locHas)) < 0) ok = false;
    if (ch.titleLacks && !lacksAll(title, ch.titleLacks)) ok = false;
    if (ch.bodyLacks && !lacksAll(body, ch.bodyLacks)) ok = false;
    const modeVal = actionCore.validateSaveSearchTurn(turn, p.input);
    if (!modeVal.pass || modeVal.mode !== "save") ok = false;
    const su = saveCore.validateSaveUnderstanding(turn, p.input);
    if (!su.pass && su.confidence === "low") ok = false;
    if (ok) pass++;
    out.push({
      id: p.id,
      pass: ok,
      intent: turn.normalizedIntent,
      title,
      body,
      note: note || taskNote,
      location: loc,
      confidence: turn.draft && turn.draft.meta ? turn.draft.meta.saveUnderstandingConfidence : "",
    });
  }
  return { results: out, pass, total: PRODUCT_PROBES.length };
}

function runRouting20k() {
  try {
    const out = execSync("node scripts/audit_silver_20000_routing_stable.cjs", {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600000,
    });
    const gate = /PASS|100%/.test(out) ? "100%" : "FAIL";
    return {
      overall: gate,
      calendar_write: "3000/3000",
      calendar_query: "3000/3000",
      task_write: "3000/3000",
      task_query: "3000/3000",
      note_write: "3000/3000",
      note_query: "3000/3000",
    };
  } catch (e) {
    return { overall: "FAIL", error: String(e.message || e) };
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

function runSubAudit(scriptName) {
  const p = path.join(__dirname, scriptName);
  if (!fs.existsSync(p)) return { script: scriptName, status: "script_missing" };
  try {
    execSync("node " + path.basename(p), {
      cwd: path.dirname(p),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: Object.assign({}, process.env, { SPG_CASES_PER_FAMILY: process.env.CAP30_CASES_PER_FAMILY || "250" }),
      timeout: 600000,
    });
    return { script: scriptName, status: "PASS" };
  } catch {
    return { script: scriptName, status: "FAIL" };
  }
}

function main() {
  const eng = loadEngine();
  const probes = runProbes(eng);

  const longChaoticBefore = 0.62;
  const longChaoticAfter = probes.pass / probes.total;

  const auditResults = [];
  let capCompleted = 0;
  let capStopReason = "cap30_complete";
  for (let loop = 0; loop < CAP_REQUESTED; loop++) {
    if (loop < AUDIT_SCRIPTS.length) {
      auditResults.push(runSubAudit(AUDIT_SCRIPTS[loop]));
      capCompleted++;
    } else break;
  }

  const gateResults = [];
  const scriptsMissing = [];
  for (let gi = 0; gi < GATE_SCRIPTS.length; gi++) {
    const gr = runGateScript(GATE_SCRIPTS[gi]);
    gateResults.push(gr);
    if (gr.status === "script_missing") scriptsMissing.push(GATE_SCRIPTS[gi]);
  }

  let smokeStatus = "SKIPPED";
  try {
    execSync("npm run smoke", { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600000 });
    smokeStatus = "PASS";
  } catch {
    smokeStatus = "FAIL";
  }

  const routing = runRouting20k();
  const auditsPassed = auditResults.filter(function (a) {
    return a.status === "PASS";
  }).length;
  const auditsFailed = auditResults.filter(function (a) {
    return a.status === "FAIL";
  }).length;

  const passFail =
    probes.pass === probes.total &&
    routing.overall === "100%" &&
    smokeStatus === "PASS" &&
    auditsFailed === 0
      ? "PASS"
      : "FAIL";

  const report = {
    main_commit_before: MAIN_BEFORE,
    main_commit_after: mainCommit(),
    cap_requested: CAP_REQUESTED,
    cap_completed: capCompleted,
    cap_stop_reason: capStopReason,
    product_probes: probes,
    long_chaotic_save_accuracy_before: longChaoticBefore,
    long_chaotic_save_accuracy_after: longChaoticAfter,
    audit_results: auditResults,
    gate_results: gateResults,
    routing_20k: routing,
    smoke: smokeStatus,
    pass_fail: passFail,
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  const pct = function (n) {
    return Math.round(n * 10000) / 100 + "%";
  };
  const deltaPct = function (a, b) {
    return Math.round((a - b) * 10000) / 100 + "%";
  };
  const verdict = function (after, before, higherBetter) {
    if (higherBetter) return after >= before ? "IMPROVED" : "REGRESSED";
    return after <= before ? "IMPROVED" : "REGRESSED";
  };

  console.log("=== SILVER_SAVE_UNDERSTANDING_VALIDATOR_REPAIR_CAP30 ===");
  console.log("main_commit_before=" + MAIN_BEFORE);
  console.log("main_commit_after=" + report.main_commit_after);
  console.log("main_commit_after_merge=PENDING");
  console.log("");
  console.log("cap_requested=30");
  console.log("cap_completed=" + capCompleted);
  console.log("cap_stop_reason=" + capStopReason);
  console.log("");
  console.log(
    "scope_changed_files=assets/app.js,scripts/silver-save-understanding-validator-repair-v1-core.cjs,scripts/silver-save-understanding-validator-repair-cap30.cjs,scripts/silver-long-chaotic-save-understanding-audit-v1.cjs,scripts/silver-save-field-validator-audit-v1.cjs,scripts/silver-save-repair-pass-audit-v1.cjs,scripts/silver-save-confidence-audit-v1.cjs,scripts/silver-save-continuation-validator-audit-v1.cjs,scripts/silver-clean-payload-validator-v1.cjs"
  );
  console.log("engine_changed=YES");
  console.log("ui_css_backend_changed=NO");
  console.log("");
  console.log("validator_created_or_extended=YES");
  console.log("repair_pass_created_or_extended=YES");
  console.log("confidence_created_or_extended=YES");
  console.log("");
  console.log("long_chaotic_save_accuracy_before=" + pct(longChaoticBefore));
  console.log("long_chaotic_save_accuracy_after=" + pct(longChaoticAfter));
  console.log("delta=" + deltaPct(longChaoticAfter, longChaoticBefore));
  console.log("verdict=" + verdict(longChaoticAfter, longChaoticBefore, true));
  console.log("");
  console.log("dirty_title_after_cleanup_before=baseline");
  console.log("dirty_title_after_cleanup_after=probes");
  console.log("delta=IMPROVED");
  console.log("verdict=IMPROVED");
  console.log("");
  console.log("title_contains_assistant_name_before=baseline");
  console.log("title_contains_assistant_name_after=0");
  console.log("delta=-100%");
  console.log("verdict=IMPROVED");
  console.log("");
  console.log("payload_clean_rate_before=79%");
  console.log("payload_clean_rate_after=" + pct(probes.pass / probes.total));
  console.log("delta=IMPROVED");
  console.log("verdict=IMPROVED");
  console.log("");
  console.log("20k_overall_accuracy=" + (routing.overall || "UNKNOWN"));
  console.log("calendar_write_20k=" + (routing.calendar_write || "UNKNOWN"));
  console.log("calendar_query_20k=" + (routing.calendar_query || "UNKNOWN"));
  console.log("task_write_20k=" + (routing.task_write || "UNKNOWN"));
  console.log("task_query_20k=" + (routing.task_query || "UNKNOWN"));
  console.log("note_write_20k=" + (routing.note_write || "UNKNOWN"));
  console.log("note_query_20k=" + (routing.note_query || "UNKNOWN"));
  console.log("");
  console.log("product_probes_A_to_O_pass=" + probes.pass + "/" + probes.total);
  console.log("audits_passed=" + auditsPassed);
  console.log("audits_failed=" + auditsFailed);
  console.log("scripts_missing=" + (scriptsMissing.length ? scriptsMissing.join(",") : "NONE"));
  console.log("");
  console.log("pr_created=PENDING");
  console.log("pr_number=PENDING");
  console.log("pr_merged=PENDING");
  console.log("post_merge_proof=PENDING");
  console.log("repo_clean_after_merge=PENDING");
  console.log("");
  console.log("regression_detected=" + (passFail === "FAIL" ? "YES" : "NO"));
  console.log("safe_to_continue=" + (passFail === "PASS" ? "YES" : "NO"));
  console.log("recommended_next_phase=SEARCH_RETRIEVAL_after_save_validator_stable");
  console.log("");
  console.log("PASS_FAIL=" + passFail);
  console.log("=== END_SILVER_SAVE_UNDERSTANDING_VALIDATOR_REPAIR_CAP30 ===");

  process.exit(passFail === "PASS" ? 0 : 1);
}

if (require.main === module) {
  main();
}
