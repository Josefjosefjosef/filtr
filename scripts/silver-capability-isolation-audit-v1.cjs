#!/usr/bin/env node
"use strict";

const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-state-governance-audit-shared.cjs");

const CASES = [
  { id: "CI_001", input: "Co umíš?", mustNotContinuation: true },
  { id: "CI_002", input: "Nápověda", mustNotContinuation: true },
  { id: "CI_003", input: "Pomoc", mustNotContinuation: true },
  { id: "CI_004", input: "Ukaž příklad příkazu", mustNotContinuation: true },
  { id: "CI_005", input: "Jak začít se Silver?", mustNotContinuation: true },
  { id: "CI_006", input: "Co neumíš?", mustNotContinuation: true },
  { id: "CI_007", input: "Jak funguje vyhledávání?", mustNotContinuation: true },
  { id: "CI_008", input: "help", mustNotContinuation: true },
  { id: "CI_009", input: "Jsi AI?", mustNotContinuation: true },
  { id: "CI_010", input: "Jak správně formulovat příkazy?", mustNotContinuation: true },
  { id: "CI_011", input: "Co umíš uložit?", mustNotContinuation: true },
  { id: "CI_012", input: "Jak navazovat na předchozí zprávy?", mustNotContinuation: true }
];

function main() {
  const eng = harness.loadEngine();
  const results = [];
  let pass = 0;
  let routerFallthrough = 0;
  let capabilityDraft = 0;
  let capabilityContinuation = 0;
  for (let i = 0; i < CASES.length; i++) {
    const r = shared.runCapabilityIsolationCase(eng, CASES[i]);
    results.push(r);
    if (r.pass) pass++;
    else {
      for (let j = 0; j < r.issues.length; j++) {
        if (r.issues[j].indexOf("intent_not_static") === 0) routerFallthrough++;
        if (r.issues[j].indexOf("capability_draft") >= 0) capabilityDraft++;
        if (r.issues[j].indexOf("continuation") >= 0) capabilityContinuation++;
      }
    }
  }
  const total = CASES.length;
  const report = {
    harness_id: "silver_capability_isolation_audit_v1",
    main_commit: shared.mainCommit(),
    cases_total: total,
    pass_count: pass,
    fail_count: total - pass,
    accuracy_pct: total ? Math.round((pass / total) * 1000) / 10 : 0,
    metrics: {
      capability_early_exit: pass === total ? "YES" : "NO",
      router_fallthrough_count: routerFallthrough,
      capability_draft_count: capabilityDraft,
      capability_continuation_count: capabilityContinuation
    },
    fails: results.filter(function (x) {
      return !x.pass;
    }),
    results: results
  };
  shared.emitReport(
    report.harness_id,
    report,
    path.join(__dirname, "silver-capability-isolation-audit-v1-report.json")
  );
  process.exit(pass === total ? 0 : 1);
}

if (require.main === module) main();
