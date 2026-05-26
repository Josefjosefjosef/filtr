#!/usr/bin/env node
"use strict";

const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-state-governance-audit-shared.cjs");

const CASES = [
  {
    id: "OC_1",
    seedSteps: ["Zítra schůzka s Kubou", "V pátek doktor", "Servis auta"],
    maxRegistryAfter: 12
  },
  {
    id: "OC_2",
    seedSteps: ["Zítra Kuba", "Počkej", "Ne vlastně doktor", "V pátek doktor"],
    maxRegistryAfter: 12
  },
  {
    id: "OC_3",
    seedSteps: ["Schůzka s Novotným", "A k tomu notebook", "Změň čas na 14"],
    maxRegistryAfter: 12
  }
];

function main() {
  const eng = harness.loadEngine();
  let pass = 0;
  const results = [];
  for (let i = 0; i < CASES.length; i++) {
    const r = shared.runOrphanCleanupCase(eng, CASES[i]);
    results.push(r);
    if (r.pass) pass++;
  }
  const total = CASES.length;
  const report = {
    harness_id: "silver_orphan_cleanup_audit_v1",
    main_commit: shared.mainCommit(),
    cases_total: total,
    pass_count: pass,
    fail_count: total - pass,
    accuracy_pct: total ? Math.round((pass / total) * 1000) / 10 : 0,
    metrics: { orphan_cleanup_accuracy: total ? Math.round((pass / total) * 1000) / 10 : 0 },
    results: results
  };
  shared.emitReport(report.harness_id, report, path.join(__dirname, "silver-orphan-cleanup-audit-v1-report.json"));
  process.exit(pass === total ? 0 : 1);
}

if (require.main === module) main();
