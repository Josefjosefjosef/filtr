#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const shared = require("./silver-conversational-continuation-ownership-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-conversational-continuation-ownership-covcap0019-report.json");

function main() {
  const diag = shared.diagnoseCovCap0019();
  const report = {
    diagnostic_id: "silver_conversational_continuation_ownership_covcap0019_v1",
    timestamp: new Date().toISOString(),
    cov_cap_0019: diag,
    PASS_FAIL: diag.pass ? "PASS" : "FAIL",
    classification: diag.classification,
    recommended_fix_scope: diag.pass ? "none_required" : "narrow_continuation_ownership_governor_v1"
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
  console.log("=== SILVER_CONVERSATIONAL_CONTINUATION_OWNERSHIP_COV_CAP_0019_DIAGNOSTIC_V1 ===");
  console.log("case_id=" + diag.case_id);
  console.log("expected_module=" + diag.expected_module);
  console.log("actual_module=" + diag.actual_module);
  console.log("actual_intent=" + diag.actual_intent);
  console.log("classification=" + diag.classification);
  console.log("previous_turn_ownership=" + (diag.turn_by_turn[0] && diag.turn_by_turn[0].module));
  console.log("continuation_governor_fired=" + diag.analysis.continuationGovernorFired);
  console.log("mobile_voice_fragment_fired=" + diag.analysis.mobileVoiceFragmentFired);
  console.log("implicit_note_cue=" + diag.analysis.implicitNoteCue);
  console.log("note_style_sentence=" + diag.analysis.noteStyleSentence);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_SILVER_CONVERSATIONAL_CONTINUATION_OWNERSHIP_COV_CAP_0019_DIAGNOSTIC_V1 ===");
  process.exit(diag.pass ? 0 : 1);
}

if (require.main === module) main();
