#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-public-readiness-chaos-100k-v1-shared.cjs");

const BASE = parseInt(process.env.SILVER_MOBILE_VOICE_CHAOS_BASE || "20000", 10);
const EXTENDED = process.env.SILVER_MOBILE_VOICE_CHAOS_EXTENDED !== "0";
const REPORT = path.join(__dirname, "silver-mobile-voice-chaos-guard-v1-report.json");

function main() {
  const cases = EXTENDED ? shared.buildMobileVoiceExtendedCorpus(BASE) : shared.buildLaneCorpus("mobile_voice", BASE);
  const report = shared.runPublicReadinessAudit(cases, REPORT);
  console.log("=== SILVER_MOBILE_VOICE_CHAOS_V1 ===");
  console.log("pass=" + Math.round((parseFloat(report.overall_accuracy) / 100) * report.total_cases) + "/" + report.total_cases);
  console.log("accuracy=" + report.overall_accuracy);
  console.log("dangerous_write_count=" + (report.counters.dangerous_write_count || 0));
  console.log("PASS_FAIL=" + (report.counters.dangerous_write_count === 0 ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_MOBILE_VOICE_CHAOS_V1 ===");
  process.exit(report.counters.dangerous_write_count === 0 ? 0 : 1);
}

if (require.main === module) main();
