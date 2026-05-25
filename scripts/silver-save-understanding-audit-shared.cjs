#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");

const REPO = path.resolve(__dirname, "..");
const { loadEngine, ctxForCase, evaluateOne, foldCs } = harness;

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function draftField(turn, name) {
  return validator.draftField(turn, name);
}

function runCase(eng, c, ctx) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const intent = turn.normalizedIntent || "";
  const title = draftField(turn, "title");
  const note = draftField(turn, "note") || draftField(turn, "body");
  const location = draftField(turn, "location");
  const issues = [];
  const expect = c.expect || c.expectedIntent || "";

  if (expect === "task" && intent !== "tasks.create") issues.push("intent_expected_tasks_create_got_" + intent);
  if (expect === "calendar" && intent !== "calendar.create") issues.push("intent_expected_calendar_create_got_" + intent);
  if (expect === "notes" && intent !== "notes.create") issues.push("intent_expected_notes_create_got_" + intent);
  if (expect === "mixed_calendar" && intent !== "calendar.create") issues.push("intent_expected_calendar_create_got_" + intent);
  if (expect === "mixed_task" && intent !== "tasks.create") issues.push("intent_expected_tasks_create_got_" + intent);
  if (expect === "mixed_task_note" && intent !== "tasks.create") issues.push("intent_expected_tasks_create_got_" + intent);
  if (expect === "not_calendar" && intent === "calendar.create") issues.push("unexpected_calendar_create");
  if (expect === "not_notes" && intent === "notes.create" && c.noNotesCreate) issues.push("unexpected_notes_create");

  if (c.titleNeed) {
    const f = foldCs(title);
    const tokens = Array.isArray(c.titleNeed) ? c.titleNeed : [c.titleNeed];
    let hit = false;
    for (let i = 0; i < tokens.length; i++) {
      if (f.indexOf(foldCs(tokens[i])) >= 0) {
        hit = true;
        break;
      }
    }
    if (!hit) issues.push("title_missing:" + tokens.join("|"));
  }

  if (c.titleMustNot) {
    const f = foldCs(title);
    const tokens = Array.isArray(c.titleMustNot) ? c.titleMustNot : [c.titleMustNot];
    for (let i = 0; i < tokens.length; i++) {
      if (f.indexOf(foldCs(tokens[i])) >= 0) issues.push("title_pollution:" + tokens[i]);
    }
  }

  if (c.noteNeed) {
    const f = foldCs(note);
    const tokens = Array.isArray(c.noteNeed) ? c.noteNeed : [c.noteNeed];
    let hit = false;
    for (let i = 0; i < tokens.length; i++) {
      if (f.indexOf(foldCs(tokens[i])) >= 0) {
        hit = true;
        break;
      }
    }
    if (!hit) issues.push("note_missing:" + tokens.join("|"));
  }

  if (c.locNeed) {
    const f = foldCs(location);
    const tokens = Array.isArray(c.locNeed) ? c.locNeed : [c.locNeed];
    let hit = false;
    for (let i = 0; i < tokens.length; i++) {
      if (f.indexOf(foldCs(tokens[i])) >= 0) {
        hit = true;
        break;
      }
    }
    if (!hit) issues.push("location_missing:" + tokens.join("|"));
  }

  if (c.companionNoteNeed && turn.silverCompanionNoteTurn) {
    const cn = draftField(turn.silverCompanionNoteTurn, "body") || draftField(turn.silverCompanionNoteTurn, "note");
    const f = foldCs(cn);
    const tokens = Array.isArray(c.companionNoteNeed) ? c.companionNoteNeed : [c.companionNoteNeed];
    let hit = false;
    for (let i = 0; i < tokens.length; i++) {
      if (f.indexOf(foldCs(tokens[i])) >= 0) {
        hit = true;
        break;
      }
    }
    if (!hit) issues.push("companion_note_missing:" + tokens.join("|"));
  }

  if (c.requireCompanionNote && !turn.silverCompanionNoteTurn) issues.push("missing_companion_note");

  if (c.noStorageDisambiguation && intent === "create.storage_disambiguation") {
    issues.push("storage_disambiguation_false_positive");
  }

  return {
    id: c.id,
    input: c.input,
    intent,
    title,
    note,
    issues,
    pass: issues.length === 0,
    turn
  };
}

function runAudit(harnessId, cases, reportJsonPath) {
  const eng = loadEngine();
  const ctx = ctxForCase("calendar_write");
  const results = [];
  let pass = 0;
  for (let i = 0; i < cases.length; i++) {
    const r = runCase(eng, cases[i], ctx);
    results.push(r);
    if (r.pass) pass++;
  }
  const total = cases.length;
  const accuracy = total ? Math.round((pass / total) * 1000) / 10 : 0;
  const report = {
    harness_id: harnessId,
    main_commit: mainCommit(),
    cases_total: total,
    pass_count: pass,
    fail_count: total - pass,
    accuracy_pct: accuracy,
    fails: results.filter(function (x) {
      return !x.pass;
    }),
    results: results
  };
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), "utf8");
  console.log("=== " + harnessId.toUpperCase() + " ===");
  console.log("harness_id=" + harnessId);
  console.log("main_commit=" + report.main_commit);
  console.log("cases_total=" + total);
  console.log("pass_count=" + pass);
  console.log("fail_count=" + (total - pass));
  console.log("accuracy_pct=" + accuracy);
  console.log("PASS_FAIL=" + (pass === total ? "PASS" : "FAIL"));
  console.log("=== END_" + harnessId.toUpperCase() + " ===");
  process.exit(pass === total ? 0 : 1);
}

module.exports = {
  REPO,
  mainCommit,
  loadEngine,
  ctxForCase,
  runCase,
  runAudit,
  draftField,
  foldCs
};
