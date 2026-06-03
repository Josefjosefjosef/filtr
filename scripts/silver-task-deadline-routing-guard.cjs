#!/usr/bin/env node
"use strict";

/**
 * SILVER_TASK_DEADLINE_ROUTING_GUARD — P1 deadline + P2 entity task query carve-outs.
 */
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const diag = require("./silver-note-answer-quality-fallback-diagnostic.cjs");
const taskDiag = require("./silver-task-query-family-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPO = path.resolve(__dirname, "..");
const REPORT_PATH = path.join(__dirname, "silver-task-deadline-routing-guard-report.json");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const TASK_DEADLINE_MUST = [
  { id: "TD_01", input: "Kdy mám zaplatit nájem", expected: "tasks.read" },
  { id: "TD_02", input: "Kdy mám koupit dárek", expected: "tasks.read" },
  { id: "TD_03", input: "Kdy mám zavolat doktorovi", expected: "tasks.read" },
  { id: "TD_04", input: "Kdy mám vyzvednout Eli", expected: "tasks.read" },
  { id: "TD_05", input: "Co mám udělat s právníkem", expected: "tasks.read" },
  { id: "TD_06", input: "Co mám zařídit kolem auta", expected: "tasks.read" }
];

const TASK_ENTITY_VYRESIT_MUST = [
  { id: "TEV_01", input: "Co mám vyřešit s doktorem", expected: "tasks.read" },
  { id: "TEV_02", input: "Co mám vyřešit s lékařem", expected: "tasks.read" },
  { id: "TEV_03", input: "Co mám vyřešit s právníkem", expected: "tasks.read" },
  { id: "TEV_04", input: "Co mám vyřešit s pojišťovnou", expected: "tasks.read" },
  { id: "TEV_05", input: "Co mám vyřešit kolem auta", expected: "tasks.read" }
];

const CALENDAR_PROTECTION = [
  { id: "CP_01", input: "Kdy mám zubaře", expected: "calendar.read" },
  { id: "CP_02", input: "Kdy mám právníka", expected: "calendar.read" },
  { id: "CP_03", input: "Kdy mám schůzku s Tomášem", expected: "calendar.read" },
  { id: "CP_04", input: "Kdy mám poradu", expected: "calendar.read" }
];

const NOTE_PROTECTION = [
  { id: "NP_01", input: "Co víš o autě", expected: "notes.read" },
  { id: "NP_02", input: "Co mám o autě", expected: "notes.read" },
  { id: "NP_03", input: "Jakou má Volvo SPZ", expected: "notes.read" },
  { id: "NP_04", input: "Jaké je heslo k wifi", expected: "notes.read" },
  { id: "NP_05", input: "Jaký je kód k trezoru", expected: "notes.read" }
];

const SAVE_PREFIX = diag.SAVE_PREFIX_FAMILY;

function seedCtx() {
  return taskDiag.seedCtx();
}

function runIntentCase(eng, ctx, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const intent = String(turn.normalizedIntent || "");
  const issues = [];
  if (WRITE_INTENTS.has(intent) && c.expected.indexOf(".read") >= 0) issues.push("write_leak:" + intent);
  if (intent !== c.expected) issues.push("intent:" + intent + "!=expected:" + c.expected);
  return {
    id: c.id,
    input: c.input,
    expected: c.expected,
    observed: intent,
    pass: issues.length === 0,
    issues: issues
  };
}

function evaluateSafetyCounters(eng, ctx) {
  let dangerous_write_count = 0;
  let false_write_count = 0;
  let write_when_negated_count = 0;
  let query_created_write_count = 0;
  const probes = TASK_DEADLINE_MUST.concat(TASK_ENTITY_VYRESIT_MUST).concat(CALENDAR_PROTECTION).concat(NOTE_PROTECTION);
  for (let i = 0; i < probes.length; i++) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(probes[i].input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    if (WRITE_INTENTS.has(intent)) {
      dangerous_write_count++;
      false_write_count++;
    }
    if (turn.processingState === "READY_TO_SAVE") {
      false_write_count++;
      query_created_write_count++;
    }
  }
  return {
    dangerous_write_count: dangerous_write_count,
    false_write_count: false_write_count,
    write_when_negated_count: write_when_negated_count,
    query_created_write_count: query_created_write_count
  };
}

function parse20kTaskQuery(out) {
  const m = /task_query=(\d+)\/3000/.exec(String(out || ""));
  return m ? m[1] + "/3000" : "UNKNOWN";
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

function main() {
  const eng = loadEngine();
  const ctx = seedCtx();
  const taskMust = TASK_DEADLINE_MUST.map(function (c) {
    return runIntentCase(eng, ctx, c);
  });
  const taskVyresit = TASK_ENTITY_VYRESIT_MUST.map(function (c) {
    return runIntentCase(eng, ctx, c);
  });
  const calProt = CALENDAR_PROTECTION.map(function (c) {
    return runIntentCase(eng, ctx, c);
  });
  const noteProt = NOTE_PROTECTION.map(function (c) {
    return runIntentCase(eng, ctx, c);
  });
  const saveRows = [];
  for (let i = 0; i < SAVE_PREFIX.length; i++) {
    const c = SAVE_PREFIX[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    saveRows.push({
      input: c.input,
      expected: c.expected,
      observed: intent,
      pass: intent === c.expected
    });
  }
  const safety = evaluateSafetyCounters(eng, ctx);

  let taskDiagSummary = null;
  try {
    taskDiagSummary = JSON.parse(
      fs.readFileSync(path.join(__dirname, "silver-task-query-family-report.json"), "utf8")
    ).summary;
  } catch (e0) {
    void e0;
  }

  const pass =
    taskMust.every(function (r) {
      return r.pass;
    }) &&
    taskVyresit.every(function (r) {
      return r.pass;
    }) &&
    calProt.every(function (r) {
      return r.pass;
    }) &&
    noteProt.every(function (r) {
      return r.pass;
    }) &&
    saveRows.every(function (r) {
      return r.pass;
    }) &&
    safety.dangerous_write_count === 0 &&
    safety.false_write_count === 0 &&
    safety.write_when_negated_count === 0 &&
    safety.query_created_write_count === 0;

  const report = {
    generatedAt: new Date().toISOString(),
    task_deadline_must: taskMust,
    task_entity_vyresit_must: taskVyresit,
    calendar_protection: calProt,
    note_protection: noteProt,
    save_prefix: saveRows,
    safety_counters: safety,
    task_diagnostic_summary: taskDiagSummary,
    pass: pass
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  const s1 = runNpm("smoke");
  const s2 = runGate("scripts/audit_silver_20000_routing_stable.cjs");
  const s3 = runGate("scripts/silver-note-answer-quality-fallback-diagnostic.cjs");
  const s4 = runNpm("silver-prod-proof");
  const taskQuery20k = parse20kTaskQuery(s2.out);

  const gatesPass =
    pass &&
    s1.ok &&
    taskQuery20k === "3000/3000" &&
    s3.ok &&
    s4.ok;

  console.log("=== SILVER_TASK_DEADLINE_ROUTING_GUARD ===");
  console.log("PASS=" + (gatesPass ? "true" : "false"));
  console.log("TASK_DEADLINE_MUST=" + taskMust.filter(function (r) { return r.pass; }).length + "/" + taskMust.length);
  console.log("TASK_ENTITY_VYRESIT_MUST=" + taskVyresit.filter(function (r) { return r.pass; }).length + "/" + taskVyresit.length);
  console.log("CALENDAR_PROTECTION=" + calProt.filter(function (r) { return r.pass; }).length + "/" + calProt.length);
  console.log("NOTE_PROTECTION=" + noteProt.filter(function (r) { return r.pass; }).length + "/" + noteProt.length);
  console.log("SAVE_PREFIX=" + (saveRows.every(function (r) { return r.pass; }) ? "true" : "false"));
  console.log("SAFETY_COUNTERS=" + JSON.stringify(safety));
  console.log("SMOKE=" + (s1.ok ? "PASS" : "FAIL"));
  console.log("TASK_QUERY_20K=" + taskQuery20k);
  console.log("NOTE_RETRIEVAL=" + (s3.ok ? "PASS" : "FAIL"));
  console.log("PROD_PROOF=" + (s4.ok ? "PASS" : "FAIL"));
  console.log("REPORT=" + REPORT_PATH);
  console.log("=== END_SILVER_TASK_DEADLINE_ROUTING_GUARD ===");
  process.exit(gatesPass ? 0 : 1);
}

if (require.main === module) main();
