#!/usr/bin/env node
/**
 * silver-query-safety-regression-guard.cjs
 * Permanent guard: query groups must never create writes or draft cards.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { run20kSliceGuard } = require("./silver-20k-regression-guard-shared.cjs");

const REPO = path.resolve(__dirname, "..");
const QUERY_GROUPS = ["calendar_query", "task_query", "note_query"];

function loadEngineWithActionCore() {
  const shared = require("./silver-20k-regression-guard-shared.cjs");
  return shared.loadEngine();
}

function runQuerySafetyProbe() {
  const audit = require("./audit_silver_20000_routing_stable.cjs");
  const eng = loadEngineWithActionCore();
  let actionCore = null;
  try {
    actionCore = require("./silver-action-mode-v1-core.cjs");
  } catch (e0) {
    void e0;
  }

  const cases = audit.buildCases().filter((c) => QUERY_GROUPS.includes(c.group));
  const metrics = {
    query_created_write_count: 0,
    query_with_draft_card_count: 0,
    dangerous_write_count: 0,
    false_write_count: 0,
    write_when_negated_count: 0
  };
  let firstFail = null;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), audit.ctxForCase(c.group));
    const ev = audit.evaluateOne(c, turn);
    const engIntent = turn.normalizedIntent || "";

    if (ev.cat === "query_created_write") metrics.query_created_write_count++;
    if (ev.cat === "write_when_negated") metrics.write_when_negated_count++;

  const isWriteIntent =
      engIntent === "calendar.create" ||
      engIntent === "tasks.create" ||
      engIntent === "notes.create" ||
      turn.processingState === "READY_TO_SAVE";
    if (QUERY_GROUPS.includes(c.group) && isWriteIntent) {
      metrics.dangerous_write_count++;
      if (!firstFail) {
        firstFail = {
          input: c.input,
          expected: c.expectedIntent,
          actual: ev.auditIntent,
          reason: "dangerous_write",
          route: engIntent
        };
      }
    }

    if (
      actionCore &&
      actionCore.turnHasDraftCardArtifact &&
      actionCore.turnHasDraftCardArtifact(turn) &&
      !turn.silverMultiIntentComposite
    ) {
      metrics.query_with_draft_card_count++;
      if (!firstFail) {
        firstFail = {
          input: c.input,
          expected: c.expectedIntent,
          actual: ev.auditIntent,
          reason: "query_with_draft_card",
          route: engIntent
        };
      }
    }

    if (!ev.pass && ev.cat === "query_created_write" && !firstFail) {
      firstFail = {
        input: c.input,
        expected: c.expectedIntent,
        actual: ev.auditIntent,
        reason: ev.cat,
        route: engIntent
      };
    }
  }

  const ok =
    metrics.query_created_write_count === 0 &&
    metrics.query_with_draft_card_count === 0 &&
    metrics.dangerous_write_count === 0 &&
    metrics.false_write_count === 0 &&
    metrics.write_when_negated_count === 0;

  return { metrics, firstFail, ok, PASS_FAIL: ok ? "PASS" : "FAIL" };
}

function main() {
  const r = runQuerySafetyProbe();
  console.log("=== SILVER_QUERY_SAFETY_REGRESSION_GUARD ===");
  console.log("guard_id=silver_query_safety_regression_guard_v1");
  console.log("query_groups=" + QUERY_GROUPS.join(","));
  console.log("query_created_write_count=" + r.metrics.query_created_write_count);
  console.log("query_with_draft_card_count=" + r.metrics.query_with_draft_card_count);
  console.log("dangerous_write_count=" + r.metrics.dangerous_write_count);
  console.log("false_write_count=" + r.metrics.false_write_count);
  console.log("write_when_negated_count=" + r.metrics.write_when_negated_count);
  if (r.firstFail) {
    console.log("first_fail_input=" + r.firstFail.input);
    console.log("first_fail_expected=" + r.firstFail.expected);
    console.log("first_fail_actual=" + r.firstFail.actual);
    console.log("first_fail_reason=" + r.firstFail.reason);
  } else {
    console.log("first_fail=(none)");
  }
  console.log("PASS_FAIL=" + r.PASS_FAIL);
  console.log("=== END_SILVER_QUERY_SAFETY_REGRESSION_GUARD ===");
  process.exit(r.ok ? 0 : 1);
}

if (require.main === module) main();
