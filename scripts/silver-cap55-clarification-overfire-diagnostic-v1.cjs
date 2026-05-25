#!/usr/bin/env node
/**
 * SILVER_CAP55_CLARIFICATION_OVERFIRE_DIAGNOSTIC_V1 — clarification / unknown / storage_disambiguation false positives.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const corpus = require("./silver-calendar-save-public-3000-corpus-v1.cjs");
const shared = require("./silver-cap55-calendar-audit-shared.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase } = harness;

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-cap55-clarification-overfire-diagnostic-v1-report.json");

function clusterKey(turn) {
  const ni = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  if (ni === "clarification") return "clarification_overfire";
  if (ni === "unknown") return "unknown_false_positive";
  if (ni === "create.storage_disambiguation" || ps === "STORAGE_DISAMBIGUATION") return "storage_disambiguation_false_positive";
  if (ps === "NEEDS_CLARIFICATION" && ni === "calendar.create") return "needs_clarification_overfire";
  return "other";
}

function main() {
  const eng = loadEngine();
  const cases = corpus.buildAllCases();
  const clusters = {};
  const samples = {};
  let overfire = 0;
  let pass = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase("calendar_write"));
    const ev = shared.evaluateCalendarCase(c, turn);
    if (ev.pass) {
      pass++;
      continue;
    }
    const key = clusterKey(turn);
    if (key.indexOf("overfire") >= 0 || key.indexOf("false_positive") >= 0) {
      overfire++;
      clusters[key] = (clusters[key] || 0) + 1;
      if (!samples[key] || samples[key].length < 5) {
        samples[key] = samples[key] || [];
        samples[key].push({
          input: c.input,
          intent: turn.normalizedIntent,
          state: turn.processingState,
          family: c.family,
          issues: ev.mustIssues.concat(ev.expectMisses),
        });
      }
    }
  }
  const rep = {
    harness_id: "silver_cap55_clarification_overfire_diagnostic_v1",
    main_commit: execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim(),
    cases_total: cases.length,
    calendar_save_pass: pass,
    clarification_overfire_count: (clusters.clarification_overfire || 0) + (clusters.needs_clarification_overfire || 0),
    unknown_false_positive_count: clusters.unknown_false_positive || 0,
    storage_disambiguation_false_positive_count: clusters.storage_disambiguation_false_positive || 0,
    top_fail_cluster: Object.keys(clusters)
      .sort(function (a, b) {
        return clusters[b] - clusters[a];
      })
      .slice(0, 5)
      .join(","),
    clarification_replay: samples,
    PASS_FAIL: overfire === 0 ? "PASS" : "FAIL",
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2), "utf8");
  console.log("=== SILVER_CAP55_CLARIFICATION_OVERFIRE_DIAGNOSTIC_V1 ===");
  console.log("cases_total=" + rep.cases_total);
  console.log("calendar_save_pass=" + rep.calendar_save_pass + "/" + rep.cases_total);
  console.log("clarification_overfire_count=" + rep.clarification_overfire_count);
  console.log("unknown_false_positive_count=" + rep.unknown_false_positive_count);
  console.log("storage_disambiguation_false_positive_count=" + rep.storage_disambiguation_false_positive_count);
  console.log("top_fail_cluster=" + rep.top_fail_cluster);
  console.log("PASS_FAIL=" + rep.PASS_FAIL);
  console.log("=== END_SILVER_CAP55_CLARIFICATION_OVERFIRE_DIAGNOSTIC_V1 ===");
  if (rep.PASS_FAIL !== "PASS") process.exit(1);
}

main();
