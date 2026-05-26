#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const corpus = require("./silver-screenshot-governance-v1-shared.cjs");
const guard = require("./silver-screenshot-help-guard-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_TASK_GUIDANCE_CASES || "600", 10);
const REPORT = path.join(__dirname, "silver-task-guidance-help-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_TASK_GUIDANCE_MIN_PCT || "99", 10);

function main() {
  const cases = corpus.buildTaskGuidanceCorpusV1(TARGET);
  const res = guard.runScreenshotHelpGuardV1({
    packName: "task_guidance",
    harnessId: "silver_task_guidance_help_v1",
    reportPath: REPORT,
    criticalInputs: corpus.CRITICAL_SCREENSHOT_PACK.task_guidance,
    corpusCases: cases,
    minPct: MIN_PCT,
    extra: { task_guidance_cases: cases.length }
  });
  fs.writeFileSync(REPORT, JSON.stringify(res.report, null, 2), "utf8");
  guard.printScreenshotHelpGuardHeader("silver_task_guidance_help_v1", res.report);
  if (!res.ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(res.ok ? 0 : 1);
}

if (require.main === module) main();
