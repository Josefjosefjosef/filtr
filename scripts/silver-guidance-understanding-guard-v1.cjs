#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-help-guidance-render-governance-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-guidance-understanding-guard-v1-report.json");

function main() {
  const guidance = [
    "Jak mám napsat schůzku?",
    "Jak mám napsat úkol?",
    "Dej mi příklad vytvoření poznámky",
    "Jen mi ukaž příklad vytvoření schůzky",
    "Co mám napsat aby se vytvořila schůzka",
    "Jak zadám připomínku",
    "Napiš mi příklad jak vytvořit úkol"
  ];
  const cases = guidance.map(function (input, i) {
    return { id: "GUD_" + String(i + 1).padStart(3, "0"), input: input, relaxed: true, expectGuidance: true };
  });
  const res = shared.runHelpGovernanceAudit("silver_guidance_understanding_v1", cases, REPORT, { guidance_cases: cases.length });
  shared.printAuditHeader("silver_guidance_understanding_v1", res.report);
  let guidanceOk = 0;
  for (let i = 0; i < res.report.fails.length; i++) {
    void res.report.fails[i];
  }
  const eng = res.eng;
  for (let j = 0; j < cases.length; j++) {
    const t = eng.processUserTurn(cases[j].input, eng.createEmptyDraft(), require("./audit_silver_realistic_mobile_corpus.cjs").ctxForCase("calendar_write"));
    if (String(t.normalizedIntent || "") === "assistant.guidance" || String(t.normalizedIntent || "") === "assistant.help") guidanceOk++;
  }
  console.log("guidance_accuracy_pct=" + Math.round((guidanceOk / cases.length) * 1000) / 10);
  const ok = res.report.pass_count === res.report.cases_total;
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
