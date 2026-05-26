#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-orchestration-payload-governance-v3-shared.cjs");

const REPORT = path.join(__dirname, "silver-late-stage-payload-overwrite-diagnostic-v1-report.json");

function main() {
  const eng = harness.loadEngine();
  const ctx = harness.ctxForCase("calendar_write");
  const probeCases = shared.EMBEDDED_REMINDER_REAL_UX.concat(shared.MULTI_STORAGE_CHAOS_PACK);
  const chains = [];
  let collisions = 0;
  let corruption = 0;

  for (let i = 0; i < probeCases.length; i++) {
    const c = probeCases[i];
    const r = c.expect === "notes" ? shared.runMultiStorageCase(eng, c, ctx) : shared.runEmbeddedCase(eng, c, ctx);
    if (!r.pass) {
      collisions++;
      const cls = shared.classifyOverwriteFailure(r, c);
      chains.push({
        case_id: c.id,
        input: c.input,
        overwrite_phase: cls.overwrite_phase,
        slot_owner: cls.slot_owner,
        collision_source: cls.collision_source,
        payload_replacement_point: cls.payload_replacement_point,
        overwrite_chain: (r.issues || []).join(" -> "),
        orchestration_order: r.intent + (r.turn && r.turn.silverCompanionTaskDraft ? "+companion_task" : "")
      });
      if (r.issues.indexOf("embedded_tail_drop") >= 0) corruption++;
    }
  }

  const report = {
    harness_id: "silver_late_stage_payload_overwrite_diagnostic_v1",
    main_commit: shared.mainCommit(),
    cases_probed: probeCases.length,
    slot_collision_count: collisions,
    payload_corruption_count: corruption,
    overwrite_chains: chains,
    PASS_FAIL: collisions === 0 ? "PASS" : "FAIL"
  };

  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_LATE_STAGE_PAYLOAD_OVERWRITE_DIAGNOSTIC ===");
  console.log("cases_probed=" + probeCases.length);
  console.log("slot_collision_count=" + collisions);
  console.log("payload_corruption_count=" + corruption);
  if (chains[0]) {
    console.log("overwrite_phase_detected=" + chains[0].overwrite_phase);
    console.log("overwrite_chain_detected=" + chains[0].overwrite_chain);
    console.log("collision_source=" + chains[0].collision_source);
    console.log("payload_replacement_point=" + chains[0].payload_replacement_point);
  } else {
    console.log("overwrite_phase_detected=none");
    console.log("overwrite_chain_detected=none");
  }
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_SILVER_LATE_STAGE_PAYLOAD_OVERWRITE_DIAGNOSTIC ===");
  process.exit(collisions === 0 ? 0 : 1);
}

if (require.main === module) main();
