#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");

const REPO = path.resolve(__dirname, "..");

function runNode(script) {
  try {
    return {
      ok: true,
      out: execSync("node " + JSON.stringify(script), {
        cwd: REPO,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 900000
      })
    };
  } catch (e) {
    return { ok: false, out: String(e.stdout || "") + String(e.stderr || ""), code: e.status || 1 };
  }
}

function parsePassFail(out) {
  const m = String(out || "").match(/PASS_FAIL=(PASS|FAIL)/g);
  if (!m || !m.length) return "FAIL";
  return m[m.length - 1].split("=")[1];
}

function parseMetric(out, key) {
  const re = new RegExp("^" + key + "=(\\d+)", "m");
  const m = String(out || "").match(re);
  return m ? parseInt(m[1], 10) : 0;
}

function parseAccuracy(out, key) {
  const re = new RegExp(key + "=([\\d.]+)%");
  const m = String(out || "").match(re);
  return m ? parseFloat(m[1]) : null;
}

function main() {
  const gates = {};
  const failures = [];

  function gate(name, script) {
    const r = runNode(path.join("scripts", script));
    const pf = parsePassFail(r.out);
    gates[name] = pf;
    if (pf !== "PASS" || !r.ok) failures.push(name);
    return r.out;
  }

  const qOut = gate("query_safety", "silver-query-safety-regression-guard.cjs");
  const prodOut = gate("production_line_v2", "silver-production-line-v2-regression-guard.cjs");
  const capIsoOut = gate("capability_isolation", "silver-capability-isolation-regression-guard.cjs");
  const govOut = gate("session_governance", "silver-session-state-governance-regression-guard.cjs");
  const segOut = gate("runtime_segmentation", "silver-runtime-layer-segmentation-diagnostic-v1.cjs");

  let audit20k = "";
  try {
    audit20k = execSync("node scripts/audit_silver_20000_routing_stable.cjs", {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 900000
    });
  } catch (e) {
    audit20k = String(e.stdout || "") + String(e.stderr || "");
    failures.push("20k_audit");
  }
  gates["20k"] =
    audit20k.indexOf("SILVER_20000_AUDIT_ABORT") < 0 &&
    audit20k.indexOf("failed=0") >= 0 &&
    (audit20k.indexOf("overall_accuracy=100") >= 0 || audit20k.indexOf("passed=20000") >= 0)
      ? "PASS"
      : "FAIL";
  if (gates["20k"] !== "PASS") failures.push("20k");

  let prodProof = "SKIP";
  const prodScript = path.join(REPO, "scripts", "silver-prod-proof.mjs");
  if (fs.existsSync(prodScript)) {
    const pp = runNode(prodScript);
    prodProof =
      pp.ok && (pp.out.indexOf('"passAll": true') >= 0 || pp.out.indexOf("passAll\":true") >= 0)
        ? "PASS"
        : "FAIL";
    if (prodProof !== "PASS") failures.push("prod_proof");
  }

  const eng = harness.loadEngine();
  let snap = null;
  if (eng.iuSilverRuntimeDebugSnapshotV1) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
      eng.iuSilverSessionStateGovernanceTickV1();
      snap = eng.iuSilverRuntimeDebugSnapshotV1();
    } catch (eSnap) {
      failures.push("debug_snapshot");
      void eSnap;
    }
  } else {
    failures.push("debug_snapshot_missing");
  }

  const safety = {
    query_created_write_count: parseMetric(qOut, "query_created_write_count"),
    query_with_draft_card_count: parseMetric(qOut, "query_with_draft_card_count"),
    dangerous_write_count: parseMetric(qOut, "dangerous_write_count"),
    false_write_count: parseMetric(qOut, "false_write_count"),
    write_when_negated_count: parseMetric(qOut, "write_when_negated_count"),
    capability_fallthrough_count: parseMetric(capIsoOut, "router_fallthrough_count"),
    capability_draft_count: parseMetric(capIsoOut, "capability_draft_count"),
    capability_continuation_count: parseMetric(capIsoOut, "capability_continuation_count")
  };

  const boundedOk =
    snap &&
    snap.active_drafts_count <= 12 &&
    snap.active_context_slots_count <= 16 &&
    snap.continuation_depth <= 8 &&
    snap.orphan_payload_count <= 4 &&
    snap.stale_context_slots_count <= 8;

  if (!boundedOk) failures.push("runtime_growth_unbounded");

  const safetySum =
    safety.query_created_write_count +
    safety.query_with_draft_card_count +
    safety.dangerous_write_count +
    safety.write_when_negated_count +
    safety.capability_fallthrough_count +
    safety.capability_draft_count +
    safety.capability_continuation_count;

  if (safetySum > 0) failures.push("safety_counters");

  const overallPass = failures.length === 0;

  console.log("=== SILVER_PUBLIC_BETA_GOVERNANCE_GUARD_V1 ===");
  console.log("PUBLIC_BETA_GOVERNANCE=" + (overallPass ? "PASS" : "FAIL"));
  console.log("query_created_write_count=" + safety.query_created_write_count);
  console.log("write_when_negated_count=" + safety.write_when_negated_count);
  console.log("capability_fallthrough_count=" + safety.capability_fallthrough_count);
  console.log("capability_draft_count=" + safety.capability_draft_count);
  console.log("capability_continuation_count=" + safety.capability_continuation_count);
  console.log("20k_overall_accuracy=" + (parseAccuracy(audit20k, "overall_accuracy") || "n/a"));
  console.log("production_line_v2=" + gates.production_line_v2);
  console.log("prod_proof=" + prodProof);
  if (snap) {
    console.log("runtime_footprint=" + (snap.memory_budget_state && snap.memory_budget_state.runtime_footprint));
    console.log("orphan_payload_count=" + snap.orphan_payload_count);
    console.log("stale_context_slots_count=" + snap.stale_context_slots_count);
  }
  console.log("gates_failed=" + (failures.length ? failures.join(",") : "(none)"));
  console.log("=== END_SILVER_PUBLIC_BETA_GOVERNANCE_GUARD_V1 ===");
  process.exit(overallPass ? 0 : 1);
}

if (require.main === module) main();
