#!/usr/bin/env node
/**
 * SILVER_WRAPPER_ISOLATION_AUDIT_V1 — wrapper must not survive in title/note/location.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const core = require("./rhc-v3-deterministic-core.cjs");
const shared = require("./silver-normalizer-field-ownership-v1-shared.cjs");
const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-wrapper-isolation-audit-v1-report.json");
const CASES = parseInt(process.env.SWI_CASES || "300", 10);

const TEMPLATES = shared.TITLE_REAL_UX_PACK.map(function (p) {
  return p.input;
}).concat([
  "Ulož mi schůzku s {person} {date}",
  "Připomeň mi {task}",
  "Hele {event} v {place}",
]);

function main() {
  const eng = loadEngine();
  const cases = [];
  for (let i = 0; i < CASES; i++) {
    const rng = core.mulberry32((i * 982451653) >>> 0);
    const tpl = TEMPLATES[i % TEMPLATES.length];
  const input = tpl.replace(/\{([a-z_]+)\}/g, function () {
      return ["Pavlem", "zítra", "poradu", "Brně"][i % 4];
    });
    cases.push({ input, group: i % 3 === 0 ? "task_write" : "calendar_write" });
  }
  let leak = shared.countWrapperLeak(cases, eng);
  let noteLeak = 0;
  for (let i = 0; i < cases.length; i++) {
    const turn = eng.processUserTurn(cases[i].input, eng.createEmptyDraft(), ctxForCase(cases[i].group));
    const note = foldCs(shared.draftField(turn, "note"));
    if (note && payloadCore.hasInstructionLeakage(shared.draftField(turn, "note"))) noteLeak++;
  }
  const rep = {
    harness_id: "silver_wrapper_isolation_audit_v1",
    main_commit: execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim(),
    cases_total: cases.length,
    wrapper_leak_count: leak,
    note_wrapper_leak_count: noteLeak,
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2));
  const ok = leak === 0 && noteLeak <= 2;
  console.log("=== SILVER_WRAPPER_ISOLATION_AUDIT_V1 ===");
  console.log("wrapper_leak_count=" + leak);
  console.log("note_wrapper_leak_count=" + noteLeak);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_WRAPPER_ISOLATION_AUDIT_V1 ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
