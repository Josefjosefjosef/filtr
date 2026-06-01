#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-task-reminder-time-preservation-diagnostic-report.json");
const FIXED_NOW = new Date("2026-06-01T12:00:00Z");

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function seedCtx() {
  return {
    now: FIXED_NOW,
    getEventsSnapshot: function () {
      return [];
    },
    getTasksSnapshot: function () {
      return [];
    },
    getNotesSnapshot: function () {
      return [];
    }
  };
}

function savedContent(turn) {
  const d = turn && turn.draft ? turn.draft : {};
  if (String(d.title || "").trim()) return String(d.title || "").trim();
  if (String(d.silverNoteText || "").trim()) return String(d.silverNoteText || "").trim();
  if (String(d.note || "").trim()) return String(d.note || "").trim();
  return "";
}

function includesFold(hay, needle) {
  return foldCs(hay).indexOf(foldCs(needle)) >= 0;
}

const TASK_REMINDER_TIME_FAMILY = [
  {
    input: "Připomeň mi zítra v 15 hod. zavolat mámě",
    expectedRoute: "tasks.create",
    mustContain: ["15", "zavolat mámě"],
    mustNotContain: ["Připomeň mi"],
    expectedTimeTokens: ["v 15 hod.", "zítra"],
    rootCauseHint: "iuSilverBuildTaskCreateTurn / findTime+findRelativeDay stripped time from title before explicit builder"
  },
  {
    input: "Připomeň mi Abych zítra nezapomněl vyzvednout tetu v nemocnici ve 14 hod.",
    expectedRoute: "tasks.create",
    mustContain: ["14", "vyzvednout tetu v nemocnici"],
    mustNotContain: ["Připomeň mi", "Nezapomněl"],
    expectedTimeTokens: ["ve 14 hod."],
    rootCauseHint: "nezapomněl wrapper + SaveUnderstandingValidator temporal leak repair dropped ve 14 hod."
  },
  {
    input: "Připomeň mi dnes v 16:30 vyzvednout Eli ve škole",
    expectedRoute: "tasks.create",
    mustContain: ["16:30", "vyzvednout Eli ve škole"],
    mustNotContain: ["Připomeň mi"],
    expectedTimeTokens: ["v 16:30", "dnes"]
  },
  {
    input: "Připomeň mi v pátek ve 12:00 zaplatit nájem",
    expectedRoute: "tasks.create",
    mustContain: ["12:00", "zaplatit nájem"],
    mustNotContain: ["Připomeň mi"],
    expectedTimeTokens: ["ve 12:00", "v pátek"]
  },
  {
    input: "Připomeň mi za hodinu zavolat doktorovi",
    expectedRoute: "tasks.create",
    mustContain: ["za hodinu", "zavolat doktorovi"],
    mustNotContain: ["Připomeň mi"],
    expectedTimeTokens: ["za hodinu"]
  },
  {
    input: "Připomeň mi večer koupit mléko",
    expectedRoute: "tasks.create",
    mustContain: ["večer", "koupit mléko"],
    mustNotContain: ["Připomeň mi"],
    expectedTimeTokens: ["večer"]
  },
  {
    input: "Připomeň zítra ráno vzít léky",
    expectedRoute: "tasks.create",
    mustContain: ["vzít léky"],
    mustContainAny: ["zítra ráno", "ráno"],
    mustNotContain: ["Připomeň"],
    expectedTimeTokens: ["zítra ráno", "ráno"]
  }
];

function evaluateCase(eng, ctx, spec) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(spec.input, eng.createEmptyDraft(), ctx);
  const observedRoute = String(turn.normalizedIntent || "");
  const content = savedContent(turn);
  const contentFold = foldCs(content);

  const routePass = observedRoute === spec.expectedRoute;
  const prefixLeaked = (spec.mustNotContain || []).find(function (tok) {
    return includesFold(content, tok);
  });
  const missingRequired = (spec.mustContain || []).filter(function (tok) {
    return !includesFold(content, tok);
  });
  let missingAny = [];
  if (spec.mustContainAny && spec.mustContainAny.length) {
    const hitAny = spec.mustContainAny.some(function (tok) {
      return includesFold(content, tok);
    });
    if (!hitAny) missingAny = spec.mustContainAny.slice();
  }

  const timePreserved = (spec.expectedTimeTokens || []).some(function (tok) {
    return includesFold(content, tok);
  });

  const pass = routePass && !prefixLeaked && missingRequired.length === 0 && missingAny.length === 0 && timePreserved;
  let rootCause = null;
  if (!routePass) rootCause = "route_mismatch expected " + spec.expectedRoute + " got " + observedRoute;
  else if (prefixLeaked) rootCause = "prefix_leaked:" + prefixLeaked;
  else if (missingRequired.length) rootCause = "missing_required:" + missingRequired.join(",");
  else if (missingAny.length) rootCause = "missing_any_of:" + missingAny.join("|");
  else if (!timePreserved) rootCause = spec.rootCauseHint || "time_not_preserved";

  return {
    input: spec.input,
    expected_route: spec.expectedRoute,
    observed_route: observedRoute,
    observed_title: content,
    expected_required_time_tokens: spec.expectedTimeTokens || [],
    time_preserved: timePreserved,
    prefix_leaked: prefixLeaked || null,
    root_cause: rootCause,
    helper_branch: spec.rootCauseHint || "iuSilverBuildExplicitTaskReminderTitleV1 + explicit snapshot restore",
    pass: pass
  };
}

function main() {
  const eng = loadEngine();
  const ctx = seedCtx();
  const rows = TASK_REMINDER_TIME_FAMILY.map(function (spec) {
    return evaluateCase(eng, ctx, spec);
  });
  const passCount = rows.filter(function (r) {
    return r.pass;
  }).length;
  const ok = passCount === rows.length;
  const report = {
    diagnostic_id: "silver_task_reminder_time_preservation_diagnostic",
    family: rows,
    pass_count: passCount,
    total: rows.length,
    PASS_FAIL: ok ? "PASS" : "FAIL"
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log("=== SILVER_TASK_REMINDER_TIME_PRESERVATION_DIAGNOSTIC ===");
  console.log("PASS_COUNT=" + passCount + "/" + rows.length);
  console.log("report_path=" + REPORT_PATH);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_SILVER_TASK_REMINDER_TIME_PRESERVATION_DIAGNOSTIC ===");
  if (!ok) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  TASK_REMINDER_TIME_FAMILY: TASK_REMINDER_TIME_FAMILY,
  evaluateCase: evaluateCase,
  seedCtx: seedCtx,
  savedContent: savedContent
};
