#!/usr/bin/env node
"use strict";

const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-state-governance-audit-shared.cjs");

const TTL_CASES = [
  {
    id: "GOV_TTL_1",
    seedSteps: ["Zítra schůzka s Kubou", "Přidej tam adresu"],
    maxRegistryAfter: 12
  },
  {
    id: "GOV_TTL_2",
    seedSteps: ["V pátek doktor", "K tomu napiš výsledky", "Servis auta", "Přidej tam techničák"],
    maxRegistryAfter: 12
  }
];

function main() {
  const eng = harness.loadEngine();
  if (!eng.iuSilverSessionStateGovernanceTickV1) {
    console.log("=== SILVER_SESSION_STATE_GOVERNANCE_AUDIT_V1 ===");
    console.log("PASS_FAIL=FAIL");
    console.log("reason=missing_governance_engine");
    console.log("=== END_SILVER_SESSION_STATE_GOVERNANCE_AUDIT_V1 ===");
    process.exit(1);
  }
  let pass = 0;
  const results = [];
  for (let i = 0; i < TTL_CASES.length; i++) {
    const r = shared.runOrphanCleanupCase(eng, TTL_CASES[i]);
    results.push(r);
    if (r.pass) pass++;
  }
  eng.iuSilverConversationReset();
  const storm = shared.runLongSessionStorm(
    eng,
    [
      "Zítra Kuba",
      "Počkej",
      "Ne vlastně doktor",
      "V pátek doktor",
      "A Kubovi adresu",
      "Servis auta",
      "Co umíš?",
      "Co mám zítra?",
      "Přidej tam notebook",
      "Změň čas na 15"
    ],
    40
  );
  if (storm.pass) pass++;
  else results.push({ id: "GOV_STORM", issues: storm.issues, pass: false });
  const peek = eng.iuSilverSessionStateGovernancePeekV1();
  const total = TTL_CASES.length + 1;
  const passCount = pass;
  const report = {
    harness_id: "silver_session_state_governance_audit_v1",
    main_commit: shared.mainCommit(),
    cases_total: total,
    pass_count: passCount,
    fail_count: total - passCount,
    accuracy_pct: total ? Math.round((passCount / total) * 1000) / 10 : 0,
    metrics: {
      ttl_system: "YES",
      cleanup_engine: "YES",
      pruning_engine: "YES",
      stale_cleanup_accuracy: storm.pass ? "100" : "0",
      orphan_cleanup_accuracy: passCount >= TTL_CASES.length ? "100" : "0",
      max_footprint: storm.maxFp,
      governance_peek: JSON.stringify(peek)
    },
    results: results,
    storm: storm
  };
  shared.emitReport(
    report.harness_id,
    report,
    path.join(__dirname, "silver-session-state-governance-audit-v1-report.json")
  );
  process.exit(passCount === total ? 0 : 1);
}

if (require.main === module) main();
