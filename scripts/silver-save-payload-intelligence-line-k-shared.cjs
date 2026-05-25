#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");

const REPO = path.resolve(__dirname, "..");
const { loadEngine, ctxForCase, foldCs } = harness;

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

function runChain(eng, steps, group) {
  eng.iuSilverConversationReset();
  const ctx = ctxForCase(group || "calendar_write");
  let prev = eng.createEmptyDraft();
  const trace = [];
  let duplicateCreates = 0;
  for (let i = 0; i < steps.length; i++) {
    const t = eng.processUserTurn(steps[i], prev, ctx);
    if (i > 0 && t.silverConversationAction !== "update" && t.normalizedIntent === "calendar.create") {
      duplicateCreates++;
    }
    trace.push(t);
    prev = t.draft || prev;
  }
  return { trace, final: trace[trace.length - 1], duplicateCreates, prev };
}

function hasAny(folded, tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (folded.indexOf(foldCs(tokens[i])) >= 0) return true;
  }
  return false;
}

function runAudit(harnessId, scenarios, reportPath) {
  const eng = loadEngine();
  const results = [];
  let pass = 0;
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    const chain = runChain(eng, s.steps, s.group);
    const turn = chain.final;
    const issues = [];
    const intent = String(turn.normalizedIntent || "");
    const title = draftField(turn, "title");
    const note = draftField(turn, "note");
    const loc = draftField(turn, "location");
    const tf = foldCs(title);
    const nf = foldCs(note);
    const lf = foldCs(loc);

    if (s.expectIntent && intent !== s.expectIntent) issues.push("intent_" + intent);
    if (s.titleNeed && !hasAny(tf, s.titleNeed)) issues.push("title_missing");
    if (s.titleMustNot && hasAny(tf, s.titleMustNot)) issues.push("title_pollution");
    if (s.noteNeed && !hasAny(nf, s.noteNeed)) issues.push("note_missing");
    if (s.locNeed && !hasAny(lf, s.locNeed) && !hasAny(tf, s.locNeed)) issues.push("location_missing");
    if (s.dateNeed && String((turn.draft && turn.draft.date) || "") !== s.dateNeed) issues.push("date_mismatch");
    if (s.timeNeed && String((turn.draft && turn.draft.time) || "") !== s.timeNeed) issues.push("time_mismatch");
    if (s.maxDuplicateCreates != null && chain.duplicateCreates > s.maxDuplicateCreates) {
      issues.push("duplicate_create");
    }
    if (s.requireUpdateAction && chain.trace.length > 1) {
      for (let ti = 1; ti < chain.trace.length; ti++) {
        if (chain.trace[ti].silverConversationAction !== "update") issues.push("missing_update_action");
      }
    }

    const ok = issues.length === 0;
    if (ok) pass++;
    results.push({ id: s.id, issues, pass: ok, title, note, loc, intent });
  }
  const accuracy = scenarios.length ? pass / scenarios.length : 1;
  const report = {
    harness_id: harnessId,
    main_commit: mainCommit(),
    cases_total: scenarios.length,
    pass_count: pass,
    accuracy,
    pass_fail: pass === scenarios.length ? "PASS" : "FAIL"
  };
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ report, results }, null, 2), "utf8");
  console.log("=== " + harnessId.toUpperCase() + " ===");
  console.log("cases_total=" + scenarios.length);
  console.log("accuracy=" + Math.round(accuracy * 10000) / 100 + "%");
  console.log("PASS_FAIL=" + report.pass_fail);
  console.log("=== END_" + harnessId.toUpperCase() + " ===");
  return report.pass_fail === "PASS" ? 0 : 1;
}

module.exports = { runAudit, runChain, foldCs, hasAny, mainCommit };
