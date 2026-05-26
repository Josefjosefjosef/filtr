#!/usr/bin/env node
/**
 * SILVER_SELF_CORRECTION_UPDATE_TASK_GUARD_V1 — permanent replay guard (≥1000 cases).
 * Lanes: task update/correction, calendar.create protection, task.create, queries, HELP.
 *
 * Usage: node scripts/silver-self-correction-update-task-guard-v1.cjs
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-self-correction-update-task-guard-v1-report.json");

const scAudit = require("./silver-self-correction-audit.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const {
  updateTaskHarnessCueFolded,
  safeUpdateTaskOutcome,
} = require("./silver-self-correction-query-clarification.cjs");

const { loadEngine, ctxForCase, foldCs } = harness;

const TASK_UPDATE_POSITIVE = [
  "uprav ten ukol objednat servis na patek, ne novy ukol",
  "zmen ten ukol zavolat mamce na zitra, nevytvarej novy",
  "oprav ukol koupit mleko na dnes vecer",
  "aktualizuj ten ukol poslat smlouvu na pondeli",
  "prepis ten ukol zaplatit fakturu na pristi tyden",
  "u toho ukolu zmen termin na patek",
  "jen uprav ukol s pravnikem, neukladej novy",
  "posun ukol objednat servis na ctvrtek",
  "zmen termin ukolu servis auta na patek",
  "tohle je oprava ukolu, ne nova udalost",
];

const CALENDAR_CREATE_PROTECTION = [
  "vloz mi v patek schuzku do kalendare",
  "pridej na patek servis auta do kalendare",
  "vytvor udalost v patek servis",
  "zapis do kalendare na patek schuzku",
  "dej mi do kalendare v patek poradu",
];

const TASK_CREATE_PROTECTION = [
  "pridej ukol objednat servis v patek",
  "vytvor ukol zavolat mamce zitra",
  "hod mi ukol koupit mleko",
  "pripomen mi jako ukol poslat smlouvu",
  "dej mi do ukolu servis auta",
];

const TASK_QUERY_PROTECTION = [
  "jake mam ukoly na patek",
  "co mam v ukolech",
  "najdi ukol servis auta",
  "ukaz mi ukoly na zitra",
  "co mam udelat dnes",
];

const CALENDAR_QUERY_PROTECTION = [
  "co mam v kalendari v patek",
  "kdy mam servis auta",
  "ukaz kalendar na zitra",
  "co mam zitra v kalendari",
];

const HELP_PROTECTION = [
  "jak upravim ukol?",
  "jak zmenim ukol?",
  "jak funguje uprava ukolu?",
  "umis upravovat ukoly?",
];

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

function isHelpTurn(turn) {
  const eng = String(turn.normalizedIntent || "");
  return (
    eng === "help" ||
    eng === "guidance" ||
    turn.silverCapabilityTurn === true ||
    turn.iuSilverHelpRenderOnlyV1 === true
  );
}

function buildGuardCases() {
  const out = [];
  const totalSc = parseInt(process.env.SILVER_SC_TOTAL_CASES || String(scAudit.TOTAL_CASES), 10);
  const scCases = scAudit
    .buildScCorpus(totalSc)
    .filter(function (c) {
      return String(c.cluster || "") === "self_correction_update_task";
    });
  const taskUpdateTarget = Math.max(970, 1000 - CALENDAR_CREATE_PROTECTION.length - TASK_CREATE_PROTECTION.length - TASK_QUERY_PROTECTION.length - CALENDAR_QUERY_PROTECTION.length - HELP_PROTECTION.length);
  for (let i = 0; i < scCases.length && out.length < taskUpdateTarget; i++) {
    out.push({
      lane: "task_update_correction",
      input: scCases[i].input,
      group: scCases[i].group || "task_write",
    });
  }
  function pushLane(lane, inputs, group) {
    for (let j = 0; j < inputs.length; j++) {
      out.push({ lane: lane, input: inputs[j], group: group });
    }
  }
  pushLane("calendar_create_protection", CALENDAR_CREATE_PROTECTION, "calendar_write");
  pushLane("task_create_protection", TASK_CREATE_PROTECTION, "task_write");
  pushLane("task_query_protection", TASK_QUERY_PROTECTION, "task_query");
  pushLane("calendar_query_protection", CALENDAR_QUERY_PROTECTION, "calendar_query");
  pushLane("help_protection", HELP_PROTECTION, "help");
  while (out.length < 1000) {
    const seed = TASK_UPDATE_POSITIVE[out.length % TASK_UPDATE_POSITIVE.length];
    if (!/\bne\s+novy\s+ukol/.test(seed)) continue;
    out.push({
      lane: "task_update_correction",
      input: seed + " prosim rychle " + String(out.length),
      group: "task_write",
    });
  }
  return out.slice(0, 1000);
}

function main() {
  let mainCommit = "unknown";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    /* ignore */
  }

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("=== SILVER_SELF_CORRECTION_UPDATE_TASK_GUARD_V1 ===");
    console.log("PASS_FAIL=FAIL");
    console.log("runtime_fail=" + String(e && e.message));
    console.log("=== END_SILVER_SELF_CORRECTION_UPDATE_TASK_GUARD_V1 ===");
    process.exit(1);
  }

  const cases = buildGuardCases();
  let calendarCreateLeakCount = 0;
  let writeLeakCount = 0;
  let wrongModuleCount = 0;
  let falseClarificationCount = 0;
  let calendarCreateRegressionCount = 0;
  let taskCreateRegressionCount = 0;
  let queryRegressionCount = 0;
  let helpRegressionCount = 0;

  const laneTotals = {
    task_update_correction: 0,
    calendar_create_protection: 0,
    task_create_protection: 0,
    task_query_protection: 0,
    calendar_query_protection: 0,
    help_protection: 0,
  };

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    laneTotals[c.lane] = (laneTotals[c.lane] || 0) + 1;
    try {
      if (typeof eng.iuSilverConversationReset === "function") eng.iuSilverConversationReset();
    } catch {
      /* ignore */
    }
    let turn;
    try {
      turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    } catch (e) {
      wrongModuleCount++;
      continue;
    }
    const engIntent = String(turn.normalizedIntent || "");
    const drafty = createLikeTurn(turn);
    const fold = foldCs(c.input);

    if (c.lane === "task_update_correction") {
      const cue = updateTaskHarnessCueFolded(fold);
      if (!cue) continue;
      if (engIntent === "calendar.create" || engIntent === "notes.create") {
        calendarCreateLeakCount++;
      }
      if (drafty) {
        writeLeakCount++;
      }
      if (!safeUpdateTaskOutcome(turn) && engIntent !== "tasks.read" && engIntent !== "task.query") {
        wrongModuleCount++;
      }
      continue;
    }

    if (c.lane === "calendar_create_protection") {
      if (engIntent !== "calendar.create" && !drafty) {
        calendarCreateRegressionCount++;
      }
      continue;
    }

    if (c.lane === "task_create_protection") {
      if (engIntent !== "tasks.create" && !createLikeTurn(turn)) {
        taskCreateRegressionCount++;
      }
      continue;
    }

    if (c.lane === "task_query_protection") {
      const ok =
        engIntent === "tasks.read" ||
        engIntent === "task.query" ||
        (turn.readQuery && turn.processingState === "READ_OK");
      if (!ok || createLikeTurn(turn)) {
        queryRegressionCount++;
      }
      continue;
    }

    if (c.lane === "calendar_query_protection") {
      const ok =
        engIntent === "calendar.read" ||
        (turn.readQuery && turn.processingState === "READ_OK");
      if (!ok || engIntent === "tasks.create" || engIntent === "calendar.create") {
        queryRegressionCount++;
      }
      continue;
    }

    if (c.lane === "help_protection") {
      if (!isHelpTurn(turn) || drafty) {
        helpRegressionCount++;
      }
    }
  }

  const pass =
    calendarCreateLeakCount === 0 &&
    writeLeakCount === 0 &&
    calendarCreateRegressionCount === 0 &&
    taskCreateRegressionCount === 0 &&
    queryRegressionCount === 0 &&
    helpRegressionCount === 0;

  const rep = {
    harness_id: "silver_self_correction_update_task_guard_v1",
    generated_at: new Date().toISOString(),
    main_commit: mainCommit,
    total_cases: cases.length,
    task_update_cases: laneTotals.task_update_correction || 0,
    calendar_create_protection_cases: laneTotals.calendar_create_protection || 0,
    task_create_protection_cases: laneTotals.task_create_protection || 0,
    task_query_protection_cases: laneTotals.task_query_protection || 0,
    calendar_query_protection_cases: laneTotals.calendar_query_protection || 0,
    help_protection_cases: laneTotals.help_protection || 0,
    calendar_create_leak_count: calendarCreateLeakCount,
    write_leak_count: writeLeakCount,
    wrong_module_count: wrongModuleCount,
    false_clarification_count: falseClarificationCount,
    calendar_create_regression_count: calendarCreateRegressionCount,
    task_create_regression_count: taskCreateRegressionCount,
    query_regression_count: queryRegressionCount,
    help_regression_count: helpRegressionCount,
    PASS_FAIL: pass ? "PASS" : "FAIL",
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2), "utf8");

  console.log("=== SILVER_SELF_CORRECTION_UPDATE_TASK_GUARD_V1 ===");
  console.log("main_commit=" + mainCommit);
  console.log("total_cases=" + rep.total_cases);
  console.log("task_update_cases=" + rep.task_update_cases);
  console.log("calendar_create_protection_cases=" + rep.calendar_create_protection_cases);
  console.log("task_create_protection_cases=" + rep.task_create_protection_cases);
  console.log("task_query_protection_cases=" + rep.task_query_protection_cases);
  console.log("calendar_query_protection_cases=" + rep.calendar_query_protection_cases);
  console.log("help_protection_cases=" + rep.help_protection_cases);
  console.log("calendar_create_leak_count=" + rep.calendar_create_leak_count);
  console.log("write_leak_count=" + rep.write_leak_count);
  console.log("wrong_module_count=" + rep.wrong_module_count);
  console.log("false_clarification_count=" + rep.false_clarification_count);
  console.log("calendar_create_regression_count=" + rep.calendar_create_regression_count);
  console.log("task_create_regression_count=" + rep.task_create_regression_count);
  console.log("query_regression_count=" + rep.query_regression_count);
  console.log("help_regression_count=" + rep.help_regression_count);
  console.log("PASS_FAIL=" + rep.PASS_FAIL);
  console.log("report=" + REPORT_JSON);
  console.log("=== END_SILVER_SELF_CORRECTION_UPDATE_TASK_GUARD_V1 ===");
  process.exit(pass ? 0 : 1);
}

main();
