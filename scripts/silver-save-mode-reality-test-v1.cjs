/**
 * SILVER_SAVE_MODE_REALITY_TEST_V1 — 40k deterministic SAVE MODE reality harness.
 * Diagnostic / gate metrics only (no engine changes).
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");

const realityCore = require("./silver-save-mode-reality-test-v1-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase } = harness;

const REPORT_JSON = path.join(__dirname, "silver-save-mode-reality-test-v1-report.json");

function countViolation(results, violationId) {
  let n = 0;
  for (let i = 0; i < results.length; i++) {
    const v = results[i].eval.violations || [];
    if (v.indexOf(violationId) >= 0) n++;
  }
  return n;
}

function sumMetric(results, key) {
  let n = 0;
  for (let i = 0; i < results.length; i++) {
    n += results[i].eval.metrics[key] || 0;
  }
  return n;
}

function main() {
  const skipGates = process.env.REALITY_SKIP_GATES === "1";
  const allCases = realityCore.generateAllCases();
  const eng = loadEngine();
  const results = [];
  for (let i = 0; i < allCases.length; i++) {
    const c = allCases[i];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    results.push({ case: c, eval: realityCore.evaluateCase(c, turn) });
  }

  const total = results.length;
  const pass = results.filter((r) => r.eval.pass).length;
  const intentOk = results.filter((r) => r.eval.intentOk).length;
  const payloadClean = results.filter((r) => r.eval.payloadClean).length;
  const semanticOk = results.filter((r) => r.eval.semanticOk).length;

  const longChaotic = results.filter((r) => r.case.tags && r.case.tags.indexOf("long_chaotic") >= 0);
  const longPass = longChaotic.filter((r) => r.eval.pass).length;

  const noteBlock = results.filter((r) => r.case.block === "notes.create");
  const notePass = noteBlock.filter((r) => r.eval.pass).length;

  const assistantNameInTitle = sumMetric(results, "title_contains_assistant_name");
  const instructionPrefixInTitle = countViolation(results, "instruction_prefix_in_title");
  const rawCommandInTitle = countViolation(results, "raw_command_stored_as_title");
  const locationFiller = countViolation(results, "location_contains_note_or_filler");

  const topFailClusters = realityCore.topFailClusters(results, 12);

  const report = {
    cases_total: total,
    deterministic_replay: realityCore.verifyDeterministicReplay(realityCore.generateAllCases),
    overall_save_accuracy: total ? pass / total : 0,
    intent_accuracy: total ? intentOk / total : 0,
    payload_clean_rate: total ? payloadClean / total : 0,
    semantic_slot_accuracy: total ? semanticOk / total : 0,
    title_contains_assistant_name_count: assistantNameInTitle,
    title_contains_command_wrapper_count: sumMetric(results, "title_contains_command_wrapper"),
    assistant_name_in_title_count: assistantNameInTitle,
    instruction_prefix_in_title_count: instructionPrefixInTitle,
    raw_command_stored_as_title_count: rawCommandInTitle,
    location_contains_note_or_filler_count: locationFiller,
    long_chaotic_sentence_accuracy: longChaotic.length ? longPass / longChaotic.length : 1,
    note_save_accuracy: noteBlock.length ? notePass / noteBlock.length : 1,
    top_fail_clusters: topFailClusters,
    mutation_errors: realityCore.getMutationErrorReport(),
    PASS_FAIL: pass === total ? "PASS" : "METRICS_ONLY",
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_SAVE_MODE_REALITY_TEST_V1 ===");
  console.log("cases_total=" + report.cases_total);
  console.log("deterministic_replay=" + (report.deterministic_replay ? "yes" : "no"));
  console.log("overall_save_accuracy=" + (report.overall_save_accuracy * 100).toFixed(2) + "%");
  console.log("payload_clean_rate=" + (report.payload_clean_rate * 100).toFixed(2) + "%");
  console.log("semantic_slot_accuracy=" + (report.semantic_slot_accuracy * 100).toFixed(2) + "%");
  console.log("assistant_name_in_title=" + assistantNameInTitle);
  console.log("instruction_prefix_in_title=" + instructionPrefixInTitle);
  console.log("raw_command_stored_as_title=" + rawCommandInTitle);
  console.log("location_contains_note_or_filler=" + locationFiller);
  console.log("long_chaotic_sentence_accuracy=" + (report.long_chaotic_sentence_accuracy * 100).toFixed(2) + "%");
  console.log("note_save_accuracy=" + (report.note_save_accuracy * 100).toFixed(2) + "%");
  for (let ti = 0; ti < Math.min(8, topFailClusters.length); ti++) {
    console.log("top_fail_" + (ti + 1) + "=" + topFailClusters[ti].cluster + ":" + topFailClusters[ti].count);
  }
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_SILVER_SAVE_MODE_REALITY_TEST_V1 ===");

  if (!skipGates && report.PASS_FAIL !== "PASS") {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
