#!/usr/bin/env node
"use strict";

const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-state-governance-audit-shared.cjs");

const SCENARIOS = [
  {
    id: "MB_1",
    group: "calendar_write",
    steps: [
      "Zítra schůzka s Kubou",
      "V pátek doktor",
      "Servis auta",
      "Schůzka s Novotným",
      "Přidej tam adresu",
      "K tomu notebook",
      "Změň čas na 10",
      "Přesuň na pátek"
    ],
    maxDrafts: 12,
    maxSlots: 16,
    maxDepth: 8
  },
  {
    id: "MB_2",
    group: "calendar_write",
    steps: ["Zítra Kuba", "Počkej", "Doktor v pátek", "A servis auta", "K tomu techničák", "A výsledky"],
    maxDrafts: 12,
    maxSlots: 16,
    maxDepth: 8
  }
];

function main() {
  const eng = harness.loadEngine();
  let pass = 0;
  const results = [];
  let growthBefore = 0;
  let growthAfter = 0;
  for (let i = 0; i < SCENARIOS.length; i++) {
    eng.iuSilverConversationReset();
    growthBefore = eng.iuSilverGovMeasureFootprintV1 ? eng.iuSilverGovMeasureFootprintV1() : 0;
    const r = shared.runMemoryBudgetCase(eng, SCENARIOS[i]);
    growthAfter = eng.iuSilverGovMeasureFootprintV1 ? eng.iuSilverGovMeasureFootprintV1() : 0;
    results.push(r);
    if (r.pass) pass++;
  }
  const total = SCENARIOS.length;
  const report = {
    harness_id: "silver_memory_budget_audit_v1",
    main_commit: shared.mainCommit(),
    cases_total: total,
    pass_count: pass,
    fail_count: total - pass,
    accuracy_pct: total ? Math.round((pass / total) * 1000) / 10 : 0,
    metrics: {
      max_drafts: 12,
      max_context_slots: 16,
      max_continuation_depth: 8,
      runtime_growth_before: growthBefore,
      runtime_growth_after: growthAfter
    },
    results: results
  };
  shared.emitReport(report.harness_id, report, path.join(__dirname, "silver-memory-budget-audit-v1-report.json"));
  process.exit(pass === total ? 0 : 1);
}

if (require.main === module) main();
