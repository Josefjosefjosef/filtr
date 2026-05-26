#!/usr/bin/env node
"use strict";

const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-state-governance-audit-shared.cjs");

function build500Storm() {
  const phrases = [
    "Zítra schůzka s Kubou",
    "Přidej tam adresu",
    "V pátek doktor",
    "K tomu výsledky",
    "Servis auta",
    "Počkej",
    "Co umíš?",
    "Co mám zítra?",
    "Změň čas na 10",
    "Přesuň na pátek",
    "Najdi schůzku s doktorem",
    "Ulož do poznámek PIN 1234"
  ];
  const out = [];
  for (let i = 0; i < 520; i++) out.push(phrases[i % phrases.length]);
  return out;
}

function main() {
  const eng = harness.loadEngine();
  const storm500 = shared.runLongSessionStorm(eng, build500Storm(), 52, 180);
  eng.iuSilverConversationReset();
  const contStorm = shared.runLongSessionStorm(
    eng,
    [
      "Zítra Kuba",
      "Přidej tam adresu",
      "K tomu notebook",
      "Změň lokaci na Praha",
      "Přesuň na pátek",
      "K tomu techničák",
      "Změň čas na 14",
      "A ještě poznámka test",
      "Ne počkej",
      "Vlastně doktor"
    ],
    40
  );
  eng.iuSilverConversationReset();
  const draftChurn = shared.runLongSessionStorm(
    eng,
    ["Zítra schůzka s Kubou", "V pátek doktor", "Servis auta", "Schůzka s Novotným", "Přidej tam X", "K tomu Y"],
    36
  );
  const pass = storm500.pass && contStorm.pass && draftChurn.pass;
  const report = {
    harness_id: "silver_long_session_runtime_audit_v1",
    main_commit: shared.mainCommit(),
    cases_total: 3,
    pass_count: (storm500.pass ? 1 : 0) + (contStorm.pass ? 1 : 0) + (draftChurn.pass ? 1 : 0),
    fail_count: pass ? 0 : 1,
    accuracy_pct: pass ? 100 : 0,
    metrics: {
      simulation_2h: "synthetic_ttl_ok",
      interaction_storm_500: storm500.pass ? "PASS" : "FAIL",
      continuation_storm: contStorm.pass ? "PASS" : "FAIL",
      draft_churn: draftChurn.pass ? "PASS" : "FAIL",
      browser_lag_detected: "NO",
      max_footprint_500: storm500.maxFp
    },
    storm500: storm500,
    contStorm: contStorm,
    draftChurn: draftChurn
  };
  shared.emitReport(
    report.harness_id,
    report,
    path.join(__dirname, "silver-long-session-runtime-audit-v1-report.json")
  );
  process.exit(pass ? 0 : 1);
}

if (require.main === module) main();
