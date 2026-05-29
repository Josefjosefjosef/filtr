#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-real-user-search-read-screenshot-v1-shared.cjs");

const FAMILIES = new Set([
  "notes_relevance_overbroad_fallback",
  "notes_direct_fact_retrieval_miss",
  "notes_object_property_relevance_and_filtering",
  "notes_address_question_not_recognized_as_read",
  "notes_warranty_query_wrong_dataset_or_overbroad",
  "notes_person_birthday_entity_matching",
  "notes_person_entity_filtering_fail",
  "person_birthday_note_query_not_recognized",
  "family_member_birthday_note_query_not_recognized"
]);

function main() {
  const all = shared.buildScreenshotCorpus();
  const cases = all.filter(function (c) {
    return FAMILIES.has(c.family) || c.lane === "NOTES_SEARCH_READ";
  });
  const report = shared.runScreenshotAudit(cases, null);
  const c = report.counters;
  const ok =
    (c.notes_overbroad_fallback_count || 0) === 0 &&
    (c.retrieval_miss_count || 0) === 0 &&
    (c.safety_risk_count || 0) === 0;

  console.log("=== SILVER_NOTES_RELEVANCE_FILTERING_GUARD_V1 ===");
  console.log("total_cases=" + report.total_cases);
  console.log("pass=" + report.pass);
  console.log("fail=" + report.fail);
  console.log("notes_overbroad_fallback_count=" + (c.notes_overbroad_fallback_count || 0));
  console.log("retrieval_miss_count=" + (c.retrieval_miss_count || 0));
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_NOTES_RELEVANCE_FILTERING_GUARD_V1 ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
