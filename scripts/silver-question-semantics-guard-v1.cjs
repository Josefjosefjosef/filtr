#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-help-guidance-render-governance-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-question-semantics-guard-v1-report.json");

function main() {
  const cases = [
    { id: "QS01", input: "Na co jsou úkoly?", requireQuestion: true },
    { id: "QS02", input: "Jak fungují poznámky?", requireQuestion: true },
    { id: "QS03", input: "Co umíš?", requireQuestion: true },
    { id: "QS04", input: "Jak můžu něco vyhledat v kalendáři?", requireQuestion: true },
    { id: "QS05", input: "Umíš kalendář?", requireQuestion: true },
    { id: "QS06", input: "K čemu jsou poznámky?", requireQuestion: true },
    { id: "QS07", input: "Jak funguje hledání?", requireQuestion: true },
    { id: "QS08", input: "Co se dá ukládat?", requireQuestion: true }
  ];
  const res = shared.runHelpGovernanceAudit("silver_question_semantics_v1", cases, REPORT, { question_cases: cases.length });
  shared.printAuditHeader("silver_question_semantics_v1", res.report);
  const ok = res.report.false_clarification_count === 0 && res.report.pass_count === res.report.cases_total;
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
