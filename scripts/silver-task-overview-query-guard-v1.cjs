#!/usr/bin/env node
"use strict";

/**
 * TASK OVERVIEW QUERY VARIANTS — regression guard (overview + protected families).
 */
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const overviewDiag = require("./silver-task-overview-query-diagnostic.cjs");
const noteDiag = require("./silver-note-answer-quality-fallback-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPO = path.resolve(__dirname, "..");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const TASK_ENTITY = [
  { id: "TE_01", input: "Co mám vyřešit s doktorem", expected: "tasks.read" },
  { id: "TE_02", input: "Co mám vyřešit s lékařem", expected: "tasks.read" },
  { id: "TE_03", input: "Co mám vyřešit s právníkem", expected: "tasks.read" },
  { id: "TE_04", input: "Co mám vyřešit s pojišťovnou", expected: "tasks.read" },
  { id: "TE_05", input: "Co mám vyřešit kolem auta", expected: "tasks.read" }
];

const TASK_DEADLINE = [
  { id: "TD_01", input: "Kdy mám zaplatit nájem", expected: "tasks.read" },
  { id: "TD_02", input: "Kdy mám koupit dárek", expected: "tasks.read" },
  { id: "TD_03", input: "Kdy mám zavolat doktorovi", expected: "tasks.read" },
  { id: "TD_04", input: "Kdy mám vyzvednout Eli", expected: "tasks.read" }
];

const NOTE_PROTECTION = [
  { id: "NP_01", input: "Jakou má Volvo SPZ", expected: "notes.read" },
  { id: "NP_02", input: "Jaké je heslo k wifi", expected: "notes.read" },
  { id: "NP_03", input: "Jaký je kód k trezoru", expected: "notes.read" },
  { id: "NP_04", input: "Kdy končí záruka na televizi", expected: "notes.read" }
];

const CALENDAR_PROTECTION = [
  { id: "CP_01", input: "Kdy mám zubaře", expected: "calendar.read" },
  { id: "CP_02", input: "Kdy mám právníka", expected: "calendar.read" },
  { id: "CP_03", input: "Kdy mám schůzku s Tomášem", expected: "calendar.read" },
  { id: "CP_04", input: "Kdy mám poradu", expected: "calendar.read" }
];

function runIntentCase(eng, ctx, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const intent = String(turn.normalizedIntent || "");
  const issues = [];
  if (WRITE_INTENTS.has(intent) && c.expected.indexOf(".read") >= 0) issues.push("write_leak");
  if (intent !== c.expected) issues.push("intent:" + intent);
  return { id: c.id, input: c.input, pass: issues.length === 0, issues: issues };
}

function runNpm(scriptName) {
  const r = spawnSync("npm", ["run", scriptName], {
    cwd: REPO,
    encoding: "utf8",
    stdio: "pipe",
    shell: true,
    maxBuffer: 32 * 1024 * 1024
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

function runGate(rel) {
  const script = path.join(REPO, rel);
  const r = spawnSync(process.execPath, [script], {
    cwd: REPO,
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 64 * 1024 * 1024
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

function main() {
  const eng = loadEngine();
  const ctx = overviewDiag.seedCtx();

  const overviewRun = spawnSync(process.execPath, [path.join(__dirname, "silver-task-overview-query-diagnostic.cjs")], {
    cwd: REPO,
    encoding: "utf8",
    stdio: "pipe"
  });
  const overviewOk = overviewRun.status === 0;

  const regressions = []
    .concat(TASK_ENTITY.map(function (c) {
      return runIntentCase(eng, ctx, c);
    }))
    .concat(TASK_DEADLINE.map(function (c) {
      return runIntentCase(eng, ctx, c);
    }))
    .concat(NOTE_PROTECTION.map(function (c) {
      return runIntentCase(eng, ctx, c);
    }))
    .concat(CALENDAR_PROTECTION.map(function (c) {
      return runIntentCase(eng, ctx, c);
    }));

  const saveRows = [];
  const saveFamily = noteDiag.SAVE_PREFIX_FAMILY || [];
  for (let i = 0; i < saveFamily.length; i++) {
    const c = saveFamily[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    saveRows.push({ input: c.input, pass: intent === c.expected });
  }

  let safetySum = 0;
  for (let ri = 0; ri < regressions.length; ri++) {
    if (!regressions[ri].pass) safetySum++;
  }
  for (let si = 0; si < saveRows.length; si++) {
    if (!saveRows[si].pass) safetySum++;
  }

  const smoke = runNpm("smoke");
  const prod = runNpm("silver-prod-proof");
  const task20k = runGate("scripts/audit_silver_20000_routing_stable.cjs");
  const task20kStat = /task_query=(\d+)\/3000/.exec(task20k.out || "");
  const task20kStr = task20kStat ? task20kStat[0] : "UNKNOWN";

  const regFail = regressions.filter(function (r) {
    return !r.pass;
  }).length;
  const saveFail = saveRows.filter(function (r) {
    return !r.pass;
  }).length;

  function familyPass(prefix) {
    const sub = regressions.filter(function (r) {
      return r.id.indexOf(prefix) === 0;
    });
    return sub.length > 0 && sub.every(function (r) {
      return r.pass;
    });
  }

  const pass =
    overviewOk &&
    regFail === 0 &&
    saveFail === 0 &&
    safetySum === 0 &&
    smoke.ok &&
    prod.ok &&
    task20k.ok;

  console.log("=== TASK_OVERVIEW_GUARD_V1 ===");
  console.log("TASK_OVERVIEW_AUDIT=" + (overviewOk ? "PASS" : "FAIL"));
  console.log("TASK_ENTITY_PROTECTION=" + (familyPass("TE_") ? "PASS" : "FAIL"));
  console.log("TASK_DEADLINE_PROTECTION=" + (familyPass("TD_") ? "PASS" : "FAIL"));
  console.log("NOTE_PROTECTION=" + (familyPass("NP_") ? "PASS" : "FAIL"));
  console.log("CALENDAR_PROTECTION=" + (familyPass("CP_") ? "PASS" : "FAIL"));
  console.log("SAVE_PREFIX_PROTECTION=" + (saveFail === 0 ? "PASS" : "FAIL"));
  console.log("REGRESSIONS=" + regFail);
  console.log("SAFETY_COUNTERS=" + safetySum);
  console.log("SMOKE=" + (smoke.ok ? "PASS" : "FAIL"));
  console.log("PROD_PROOF=" + (prod.ok ? "PASS" : "FAIL"));
  console.log("TASK_QUERY_20K=" + task20kStr);
  console.log("PASS_FAIL=" + (pass ? "PASS" : "FAIL"));
  console.log("=== END_TASK_OVERVIEW_GUARD_V1 ===");

  try {
    const side = path.join(__dirname, "silver-task-overview-query-diagnostic-report.json");
    if (fs.existsSync(side)) fs.unlinkSync(side);
  } catch (eDel) {
    void eDel;
  }
  try {
    const fam = path.join(__dirname, "silver-task-query-family-report.json");
    if (fs.existsSync(fam)) fs.unlinkSync(fam);
  } catch (eDel2) {
    void eDel2;
  }

  process.exit(pass ? 0 : 1);
}

if (require.main === module) main();
