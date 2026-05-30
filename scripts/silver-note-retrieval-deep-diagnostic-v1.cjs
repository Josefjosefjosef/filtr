#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-note-retrieval-platform-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-note-retrieval-deep-diagnostic-v1-report.json");
const CASES = Math.min(12000, Math.max(4000, parseInt(process.env.NRP_DEEP_CASES || "6000", 10)));

function main() {
  const corpus = shared.buildCorpusV1(CASES);
  const res = shared.runAudit("NOTE_RETRIEVAL_DEEP_DIAGNOSTIC", corpus, REPORT);
  const ff = res.report.fail_families || {};
  console.log("=== NOTE_RETRIEVAL_DEEP_DIAGNOSTIC ===");
  console.log("total_cases=" + res.report.total);
  console.log("pass=" + res.report.pass);
  console.log("fail=" + res.report.fail);
  console.log("tier_a_accuracy_percent=" + res.report.tier_a_accuracy_percent);
  console.log("entity_match_fail=" + (ff.entity_match_fail || 0));
  console.log("attribute_extraction_fail=" + (ff.attribute_extraction_fail || 0));
  console.log("topic_pollution_fail=" + (ff.topic_pollution_fail || 0));
  console.log("truthful_count_fail=" + (ff.truthful_count_fail || 0));
  console.log("answer_vs_list_fail=" + (ff.answer_vs_list_fail || 0));
  console.log("alias_resolution_fail=" + (ff.alias_resolution_fail || 0));
  console.log("relevance_cutoff_fail=" + (ff.relevance_cutoff_fail || 0));
  console.log("hallucination_fail=" + (ff.hallucination_fail || 0));
  console.log("ranking_fail=" + (ff.ranking_fail || 0));
  console.log("multi_result_fail=" + (ff.multi_result_fail || 0));
  console.log("query_created_write_count=" + res.report.query_created_write_count);
  console.log("dangerous_write_count=" + res.report.dangerous_write_count);
  console.log("PASS_FAIL=" + res.report.PASS_FAIL);
  if (res.report.first_fail) {
    console.log("sample_fail_id=" + res.report.first_fail.id);
    console.log("sample_fail_family=" + res.report.first_fail.failFamily);
    console.log("sample_fail_input=" + res.report.first_fail.input);
  }
  console.log("=== END_NOTE_RETRIEVAL_DEEP_DIAGNOSTIC ===");
  process.exit(res.report.PASS_FAIL === "PASS" && res.report.dangerous_write_count === 0 ? 0 : 1);
}

if (require.main === module) main();
