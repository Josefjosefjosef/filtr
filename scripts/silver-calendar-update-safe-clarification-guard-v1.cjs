#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const corpus = require("./silver-screenshot-governance-v1-shared.cjs");

const REPO = path.resolve(__dirname, "..");
const REPORT = path.join(__dirname, "silver-calendar-update-safe-clarification-guard-v1-report.json");
const TARGET = parseInt(process.env.SILVER_CALENDAR_UPDATE_SAFE_CASES || "200", 10);

const WRITE_INTENTS = new Set(["calendar.create", "tasks.create", "notes.create", "create.storage_disambiguation"]);

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function evaluateCase(eng, c, ctx) {
  const issues = [];
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const intent = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const clar = String(turn.clarificationReason || "");

  if (ps === "READY_TO_SAVE") issues.push("must_not_ready_to_save");
  if (WRITE_INTENTS.has(intent)) issues.push("must_not_write_intent:" + intent);
  if (turn.storageDisambiguation) issues.push("must_not_storage_disambiguation");
  const d = turn.draft || {};
  if (String(d.title || "").trim().length > 2 && intent === "calendar.create") {
    issues.push("must_not_new_event_draft");
  }
  const safeClar =
    ps === "CLARIFICATION" ||
    clar === "needs_existing_event_selection" ||
    intent === "calendar.update" ||
    clar.indexOf("update") >= 0 ||
    clar.indexOf("existing") >= 0;
  if (!safeClar) issues.push("expected_safe_clarification_got_" + ps + "_" + clar);

  return { id: c.id, input: c.input, intent, ps, clar, issues, pass: issues.length === 0 };
}

function main() {
  const eng = harness.loadEngine();
  const ctx = harness.ctxForCase("calendar_query");
  const critical = corpus.CRITICAL_SCREENSHOT_PACK.calendar_update.map(function (input, i) {
    return { id: "CRIT_CAL_" + String(i + 1).padStart(2, "0"), input: input, critical: true };
  });
  const cases = corpus.buildCalendarUpdateSafeCorpusV1(TARGET);
  const allCases = critical.concat(cases);
  const results = [];
  let pass = 0;
  let criticalPass = 0;
  for (let i = 0; i < allCases.length; i++) {
    const r = evaluateCase(eng, allCases[i], ctx);
    results.push(r);
    if (r.pass) pass++;
    if (allCases[i].critical && r.pass) criticalPass++;
  }
  const total = allCases.length;
  const accuracy = total ? Math.round((pass / total) * 1000) / 10 : 0;
  const criticalOk = criticalPass === critical.length;
  const ok = criticalOk && pass === total;
  const report = {
    harness_id: "silver_calendar_update_safe_clarification_v1",
    main_commit: mainCommit(),
    critical_cases_total: critical.length,
    critical_pass_count: criticalPass,
    critical_pass: criticalOk ? "PASS" : "FAIL",
    cases_total: total,
    pass_count: pass,
    fail_count: total - pass,
    accuracy_pct: accuracy,
    fails: results.filter(function (x) {
      return !x.pass;
    }).slice(0, 30),
    PASS_FAIL: ok ? "PASS" : "FAIL"
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
  console.log("=== SILVER_CALENDAR_UPDATE_SAFE_CLARIFICATION_V1 ===");
  console.log("critical_cases_total=" + critical.length);
  console.log("critical_pass_count=" + criticalPass);
  console.log("critical_pass=" + (criticalOk ? "PASS" : "FAIL"));
  console.log("cases_total=" + total);
  console.log("pass_count=" + pass);
  console.log("fail_count=" + (total - pass));
  console.log("accuracy_pct=" + accuracy);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_SILVER_CALENDAR_UPDATE_SAFE_CLARIFICATION_V1 ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
