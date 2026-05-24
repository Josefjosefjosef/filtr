#!/usr/bin/env node
/**
 * SILVER_PUBLIC_SAVE_READINESS_AUDIT_V1 — CAP53 public save readiness ≥97%.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const pack = require("./silver-public-save-readiness-pack-v1.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const saveCore = require("./silver-save-understanding-validator-repair-v1-core.cjs");
const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const antiDup = require("./silver-audit-anti-duplication-v1.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-public-save-readiness-audit-v1-report.json");
const MIN_ACCURACY = 0.97;

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function evaluateCase(c, turn) {
  const payloadVal = validator.validateCleanPayload(turn, c.input);
  let pass = payloadVal.pass;
  const intent = String(turn.normalizedIntent || "");
  const fold = foldCs(c.input);
  if (c.group === "calendar_write" && intent === "notes.create" && payloadCore.isEventNoteContext(c.input)) {
    pass = false;
  }
  if (c.group === "note_write" && intent === "calendar.create" && !payloadCore.isCalendarSchedulingContext(c.input)) {
    pass = false;
  }
  if (c.group === "calendar_query" && (intent.indexOf(".create") >= 0 || turn.processingState === "READY_TO_SAVE")) {
    pass = false;
  }
  if (/\bne\s+uklad/.test(fold) && intent.indexOf(".create") >= 0) pass = false;
  const saveVal = saveCore.validateSaveUnderstanding(turn, c.input);
  if (!saveVal.pass) pass = false;
  const note = foldCs(validator.draftField(turn, "note"));
  if (note && /\b(do\s+poznam\w*\s+napi[sš]|dej\s+mi\s+do\s+poznam)\b/.test(note)) pass = false;
  return { pass, payloadVal, violations: payloadVal.violations };
}

function main() {
  const eng = loadEngine();
  const rawCases = pack.generatePackCases();
  const filtered = antiDup.filterUniqueCases(rawCases);
  const cases = filtered.accepted;
  const clusterFails = {};
  let pass = 0;
  let eventNoteLeak = 0;
  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const ev = evaluateCase(c, turn);
    if (ev.pass) pass++;
    else {
      const v0 = (ev.violations || [])[0] || "unknown";
      clusterFails[v0] = (clusterFails[v0] || 0) + 1;
      if (turn.normalizedIntent === "notes.create" && payloadCore.isEventNoteContext(c.input)) eventNoteLeak++;
    }
  }
  const probes = [
    {
      id: "PSR1",
      input:
        "hele prosim te zejtra v 10 schuzka s pravnikem nekde na vinohradech jo a pripomen mi vzit smlouvy",
      intent: "calendar.create",
      group: "calendar_write",
    },
    {
      id: "PSR2",
      input: "Silver ulož mi někam že mám koupit skotskou",
      intent: "notes.create",
      group: "note_write",
    },
    {
      id: "PSR3",
      input: "kolik mám schůzek zítra",
      intent: "calendar.read",
      group: "calendar_query",
    },
  ];
  let probePass = 0;
  for (let pi = 0; pi < probes.length; pi++) {
    const p = probes[pi];
    const turn = eng.processUserTurn(p.input, eng.createEmptyDraft(), ctxForCase(p.group));
    if (String(turn.normalizedIntent || "") === p.intent) probePass++;
  }
  const accuracy = cases.length ? pass / cases.length : 1;
  const top = Object.keys(clusterFails)
    .sort(function (a, b) {
      return clusterFails[b] - clusterFails[a];
    })
    .slice(0, 5)
    .map(function (k) {
      return { cluster: k, count: clusterFails[k] };
    });
  const report = {
    harness_id: "silver_public_save_readiness_audit_v1",
    main_commit: mainCommit(),
    cases_total: cases.length,
    public_save_readiness_accuracy: accuracy,
    event_note_leaked_to_notes_create_count: eventNoteLeak,
    product_probes_pass: probePass + "/" + probes.length,
    top_fail_clusters: top,
    pass_fail: accuracy >= MIN_ACCURACY && probePass === probes.length && eventNoteLeak === 0 ? "PASS" : "FAIL",
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  console.log("=== SILVER_PUBLIC_SAVE_READINESS_AUDIT_V1 ===");
  console.log("cases_total=" + cases.length);
  console.log("public_save_readiness_accuracy=" + Math.round(accuracy * 10000) / 100 + "%");
  console.log("event_note_leaked_to_notes_create_count=" + eventNoteLeak);
  console.log("product_probes_pass=" + report.product_probes_pass);
  console.log("PASS_FAIL=" + report.pass_fail);
  console.log("=== END_SILVER_PUBLIC_SAVE_READINESS_AUDIT_V1 ===");
  process.exit(report.pass_fail === "PASS" ? 0 : 1);
}

main();
