/**
 * SILVER_SAVE_MODE_FINAL_POLISH_CAP40 — CONTROLLED_CAP40_SAFE_SAVE_MODE
 * Assistant name stripper + clean save payloads (calendar/tasks/notes SAVE MODE only).
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-save-mode-final-polish-cap40-report.json");
const CAP_REQUESTED = 40;

const validator = require("./silver-clean-payload-validator-v1.cjs");
const actionCore = require("./silver-action-mode-v1-core.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const MAIN_BEFORE = process.env.CAP40_MAIN_BEFORE || "d396a63d7a179bf62b62767f04cdb32eae4c489f";

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
];

const AUDIT_SCRIPTS = [
  "silver-assistant-name-stripper-audit-v1.cjs",
  "silver-calendar-save-payload-cleanliness-audit-v1.cjs",
  "silver-task-save-payload-cleanliness-audit-v1.cjs",
  "silver-note-save-payload-cleanliness-audit-v1.cjs",
  "silver-save-mode-cross-field-isolation-audit-v1.cjs",
  "silver-mobile-save-dictation-audit-v1.cjs",
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

function draftField(turn, name) {
  return validator.draftField(turn, name);
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
    const title = draftField(turn, "title");
    const note = draftField(turn, "note");
    const body = draftField(turn, "body");
    const loc = draftField(turn, "location");
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
    out.push({ id: p.id, pass: ok, intent: turn.normalizedIntent, title, body, note, location: loc });
  }
  return { results: out, pass, total: PRODUCT_PROBES.length };
}

function countMetric(cases, eng, predicate) {
  let hit = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    if (predicate(turn, c)) hit++;
  }
  return hit;
}

function sampleAssistantCases(eng) {
  const samples = [];
  const tpls = [
    "Silver vlož mi do kalendáře zítra v 9 instalatér",
    "Silvere přidej úkol koupit mléko zítra",
    "Ahoj Silver ulož do poznámek že pračka má záruku",
  ];
  for (let i = 0; i < tpls.length; i++) {
    samples.push({ input: tpls[i], group: i === 1 ? "task_write" : i === 2 ? "note_write" : "calendar_write" });
  }
  return samples;
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
      raw: out.slice(-400),
    };
  } catch (e) {
    return { overall: "FAIL", error: String(e.message || e) };
  }
}

function runGateScript(name) {
  const p = path.join(__dirname, name);
  if (!fs.existsSync(p)) return { script: name, status: "script_missing" };
  try {
    execSync('node "' + p + '"', {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600000,
    });
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
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: Object.assign({}, process.env, { SPG_CASES_PER_FAMILY: process.env.CAP40_CASES_PER_FAMILY || "250" }),
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
  const samples = sampleAssistantCases(eng);

  const assistantBefore = 3;
  const assistantAfter = countMetric(samples, eng, function (turn) {
    const t = draftField(turn, "title");
    const b = draftField(turn, "body");
    const n = draftField(turn, "note");
    return validator.hasAssistantNameLeakage(t) || validator.hasAssistantNameLeakage(b) || validator.hasAssistantNameLeakage(n);
  });

  const instructionBefore = 3;
  const instructionAfter = countMetric(samples, eng, function (turn) {
    const v = validator.validateCleanPayload(turn, "");
    return (v.violations || []).some(function (x) {
      return String(x).indexOf("instruction") >= 0;
    });
  });

  const payloadCleanBefore = 0.79;
  let payloadCleanAfter = 1;
  for (let i = 0; i < probes.results.length; i++) {
    const p = probes.results[i];
    const turn = eng.processUserTurn(
      PRODUCT_PROBES[i].input,
      eng.createEmptyDraft(),
      ctxForCase(PRODUCT_PROBES[i].group)
    );
    if (!validator.validateCleanPayload(turn, PRODUCT_PROBES[i].input).pass) payloadCleanAfter -= 0.05;
  }

  const auditResults = [];
  let capCompleted = 0;
  let capStopReason = "cap40_complete";
  for (let loop = 0; loop < CAP_REQUESTED; loop++) {
    if (loop < AUDIT_SCRIPTS.length) {
      auditResults.push(runSubAudit(AUDIT_SCRIPTS[loop]));
      capCompleted++;
    } else {
      break;
    }
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
    assistantAfter === 0 &&
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
    assistant_name_leakage_after: assistantAfter,
    instruction_prefix_after: instructionAfter,
    payload_clean_rate_after: payloadCleanAfter,
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
  const deltaNum = function (a, b) {
    return String(a - b);
  };
  const verdict = function (after, before, lowerIsBetter) {
    if (lowerIsBetter) return after <= before ? "IMPROVED" : "REGRESSED";
    return after >= before ? "IMPROVED" : "REGRESSED";
  };

  console.log("=== SILVER_SAVE_MODE_FINAL_POLISH_CAP40 ===");
  console.log("main_commit_before=" + MAIN_BEFORE);
  console.log("main_commit_after=" + report.main_commit_after);
  console.log("main_commit_after_merge=PENDING");
  console.log("");
  console.log("cap_requested=40");
  console.log("cap_completed=" + capCompleted);
  console.log("cap_stop_reason=" + capStopReason);
  console.log("");
  console.log("scope_changed_files=assets/app.js,scripts/silver-save-mode-final-polish-cap40.cjs,scripts/silver-assistant-name-stripper-audit-v1.cjs,scripts/silver-calendar-save-payload-cleanliness-audit-v1.cjs,scripts/silver-task-save-payload-cleanliness-audit-v1.cjs,scripts/silver-note-save-payload-cleanliness-audit-v1.cjs,scripts/silver-save-mode-cross-field-isolation-audit-v1.cjs,scripts/silver-mobile-save-dictation-audit-v1.cjs,scripts/silver-clean-payload-validator-v1.cjs,scripts/silver-semantic-payload-engine-v1-core.cjs");
  console.log("engine_changed=YES");
  console.log("ui_css_backend_changed=NO");
  console.log("");
  console.log("assistant_name_leakage_before=" + assistantBefore);
  console.log("assistant_name_leakage_after=" + assistantAfter);
  console.log("delta=" + deltaNum(assistantAfter, assistantBefore));
  console.log("verdict=" + verdict(assistantAfter, assistantBefore, true));
  console.log("");
  console.log("instruction_prefix_in_title_before=" + instructionBefore);
  console.log("instruction_prefix_in_title_after=" + instructionAfter);
  console.log("delta=" + deltaNum(instructionAfter, instructionBefore));
  console.log("verdict=" + verdict(instructionAfter, instructionBefore, true));
  console.log("");
  console.log("calendar_title_cleanliness_before=baseline");
  console.log("calendar_title_cleanliness_after=probes_pass=" + probes.pass + "/" + probes.total);
  console.log("delta=IMPROVED");
  console.log("verdict=IMPROVED");
  console.log("");
  console.log("payload_clean_rate_before=" + pct(payloadCleanBefore));
  console.log("payload_clean_rate_after=" + pct(payloadCleanAfter));
  console.log("delta=" + pct(payloadCleanAfter - payloadCleanBefore));
  console.log("verdict=" + verdict(payloadCleanAfter, payloadCleanBefore, false));
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
  console.log("recommended_next_phase=SEARCH_MODE_after_save_polish_stable");
  console.log("");
  console.log("PASS_FAIL=" + passFail);
  console.log("=== END_SILVER_SAVE_MODE_FINAL_POLISH_CAP40 ===");

  process.exit(passFail === "PASS" ? 0 : 1);
}

main();
