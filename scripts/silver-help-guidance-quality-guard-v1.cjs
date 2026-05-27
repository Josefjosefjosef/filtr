#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-product-trust-layer-v2-shared.cjs");
const REPORT = path.join(__dirname, "silver-help-guidance-quality-guard-v1-report.json");
function main() {
  const all = shared.buildCorpusV1(1100);
  const families = new Set([
    "help_guidance_quality",
    "task_help_guidance",
    "calendar_help_guidance",
    "notes_help_guidance",
    "how_to_prompt_guidance",
    "onboarding_questions",
    "spoken_czech_guidance",
    "confused_user_prompts"
  ]);
  const cases = all.filter(function (c) {
    return families.has(c.family) || c.mode === "help";
  });
  const res = shared.runAudit("silver_help_guidance_quality_guard_v1", cases, REPORT);
  const ok = res.report.tier_a_pass === res.report.tier_a_total && res.report.tier_a_save_leaks === 0 && shared.printAuditHeader("silver_help_guidance_quality_v1", res.report, null);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
