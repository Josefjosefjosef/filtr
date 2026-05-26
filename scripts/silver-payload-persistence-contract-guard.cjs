#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-orchestration-payload-governance-v3-shared.cjs");

const REPORT = path.join(__dirname, "silver-payload-persistence-contract-guard-report.json");

function main() {
  const contract = shared.PAYLOAD_PERSISTENCE_CONTRACT_V1;
  const eng = harness.loadEngine();
  const ctx = harness.ctxForCase("calendar_write");
  const cases = shared.EMBEDDED_REMINDER_REAL_UX.slice(0, 5);
  let slotViolations = 0;
  let pass = 0;

  for (let i = 0; i < cases.length; i++) {
    const r = shared.runEmbeddedCase(eng, cases[i], ctx);
    const turn = r.turn || {};
    const noteOwner = contract.slots.note.protected_owner;
    let ok = r.pass;
    if (turn.normalizedIntent !== noteOwner && r.intent === "calendar.create") ok = false;
    if (turn.silverCompanionTaskDraft && contract.slots.companion_task.overwrite_policy === "secondary_never_overwrites_primary") {
      const note = String((turn.draft && turn.draft.note) || "").trim();
      if (!note && cases[i].noteNeed) {
        slotViolations++;
        ok = false;
      }
    }
    if (ok) pass++;
    else slotViolations++;
  }

  const total = cases.length;
  const okAll = slotViolations === 0 && pass === total;

  fs.writeFileSync(
    REPORT,
    JSON.stringify(
      {
        harness_id: contract.harness_id,
        main_commit: shared.mainCommit(),
        contract_slots: Object.keys(contract.slots),
        cases_checked: total,
        slot_violation_count: slotViolations,
        payload_integrity_accuracy_pct: total ? Math.round((pass / total) * 10000) / 100 : 0
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("=== SILVER_PAYLOAD_PERSISTENCE_CONTRACT_GUARD ===");
  console.log("contract_version=v1");
  console.log("cases_checked=" + total);
  console.log("slot_violation_count=" + slotViolations);
  console.log("payload_integrity_accuracy_pct=" + (total ? Math.round((pass / total) * 10000) / 100 : 0));
  console.log("PASS_FAIL=" + (okAll ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_PAYLOAD_PERSISTENCE_CONTRACT_GUARD ===");
  process.exit(okAll ? 0 : 1);
}

if (require.main === module) main();
