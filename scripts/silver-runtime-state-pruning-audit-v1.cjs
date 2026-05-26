#!/usr/bin/env node
"use strict";

const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-state-governance-audit-shared.cjs");

function synthStormSteps(n) {
  const base = [
    "Zítra schůzka s Kubou",
    "Přidej tam adresu",
    "V pátek doktor",
    "K tomu výsledky",
    "Servis auta",
    "Počkej",
    "Ne vlastně Kuba",
    "Změň čas na 15",
    "Co umíš?",
    "Co mám zítra?"
  ];
  const out = [];
  for (let i = 0; i < n; i++) out.push(base[i % base.length]);
  return out;
}

function main() {
  const eng = harness.loadEngine();
  const before = eng.iuSilverGovMeasureFootprintV1 ? eng.iuSilverGovMeasureFootprintV1() : 0;
  const storm = shared.runLongSessionStorm(eng, synthStormSteps(120), 48, 45);
  const after = eng.iuSilverGovMeasureFootprintV1 ? eng.iuSilverGovMeasureFootprintV1() : 0;
  const pass = storm.pass && after <= 48;
  const report = {
    harness_id: "silver_runtime_state_pruning_audit_v1",
    main_commit: shared.mainCommit(),
    cases_total: 1,
    pass_count: pass ? 1 : 0,
    fail_count: pass ? 0 : 1,
    accuracy_pct: pass ? 100 : 0,
    metrics: {
      runtime_growth_before: before,
      runtime_growth_after: after,
      storm_max_footprint: storm.maxFp,
      duplicate_creates: storm.dupCreates,
      pruning_engine: "YES"
    },
    storm: storm
  };
  shared.emitReport(
    report.harness_id,
    report,
    path.join(__dirname, "silver-runtime-state-pruning-audit-v1-report.json")
  );
  process.exit(pass ? 0 : 1);
}

if (require.main === module) main();
