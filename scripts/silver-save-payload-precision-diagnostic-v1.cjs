#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-save-payload-precision-diagnostic-v1-report.json");
const CASES_PER_FAMILY = parseInt(process.env.CSPP_DIAG_CASES_PER_FAMILY || "120", 10);

const core = require("./rhc-v3-deterministic-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const actionCore = require("./silver-action-mode-v1-core.cjs");
const antiDup = require("./silver-audit-anti-duplication-v1.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { generateCases } = require("./silver-save-payload-precision-production-line-v1.cjs");

const { loadEngine, ctxForCase, foldCs } = harness;

function clusterForViolations(violations, turn, rawText) {
  const v = violations || [];
  const foldTitle = foldCs(String((turn.draft && (turn.draft.title || turn.draft.eventTitle)) || ""));
  const tags = [];
  if (v.some((x) => x.indexOf("instruction") >= 0 || x.indexOf("raw_command") >= 0)) tags.push("title_contamination");
  if (v.some((x) => x.indexOf("wrapper") >= 0)) tags.push("wrapper_contamination");
  if (v.some((x) => x.indexOf("reminder") >= 0 || x.indexOf("embedded") >= 0)) tags.push("missing_reminder_tail");
  if (v.some((x) => x.indexOf("note") >= 0 || x.indexOf("body") >= 0)) tags.push("note_leakage");
  if (v.some((x) => x.indexOf("location") >= 0 || x.indexOf("address") >= 0)) tags.push("location_leakage");
  if (v.some((x) => x.indexOf("field") >= 0 || x.indexOf("ownership") >= 0)) tags.push("field_ownership_fail");
  if (v.some((x) => x.indexOf("clarif") >= 0)) tags.push("clarification_before_cleanup");
  if (v.some((x) => x.indexOf("partial") >= 0 || x.indexOf("empty") >= 0)) tags.push("partial_extraction");
  if (v.some((x) => x.indexOf("continuation") >= 0 || x.indexOf("stale") >= 0)) tags.push("follow_up_contamination");
  if (!tags.length && !turn) tags.push("partial_extraction");
  if (!tags.length) tags.push("payload_contract_gap");
  if (/\b(ne|n[eé])\s+vlastn[eě]\b/.test(foldCs(rawText))) tags.push("ambiguity");
  return tags.length ? tags : ["payload_contract_gap"];
}

function classifyRootCause(tags, violations, mv) {
  if (mv && mv.reason === "expected_clarification") return "safe_clarification";
  if (tags.indexOf("ambiguity") >= 0) return "ambiguity";
  if (!violations || !violations.length) {
    if (mv && mv.pass === false) return "payload_contract_gap";
    return "harness_problem";
  }
  const vStr = violations.join(",");
  if (/leaked|routed/.test(vStr)) return "true_engine_bug";
  if (/instruction|raw_command|wrapper|address/.test(vStr)) return "true_engine_bug";
  return "payload_contract_gap";
}

function main() {
  const eng = loadEngine();
  const allRaw = generateCases();
  const filtered = antiDup.filterUniqueCases(allRaw);
  const cases = filtered.accepted.slice(0, Math.min(filtered.accepted.length, CASES_PER_FAMILY * 26));

  const clusterCounts = {};
  const rootCounts = {
    true_engine_bug: 0,
    harness_problem: 0,
    gold_label_problem: 0,
    ambiguity: 0,
    safe_clarification: 0,
    expected_unknown: 0,
    payload_contract_gap: 0,
  };
  let pass = 0;
  const topFails = [];

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const pv = validator.validateCleanPayload(turn, c.input);
    const mv = actionCore.validateSaveSearchTurn(turn, c.input);
    const ok = pv.pass && mv.pass;
    if (ok) {
      pass++;
      continue;
    }
    const violations = (pv.violations || []).concat(mv.violations || []);
    const tags = clusterForViolations(violations, turn, c.input);
    for (let ti = 0; ti < tags.length; ti++) {
      clusterCounts[tags[ti]] = (clusterCounts[tags[ti]] || 0) + 1;
    }
    const rc = classifyRootCause(tags, violations, mv);
    rootCounts[rc] = (rootCounts[rc] || 0) + 1;
    if (topFails.length < 40) {
      topFails.push({
        id: c.id,
        family: c.family,
        input: String(c.input).slice(0, 120),
        violations: violations.slice(0, 6),
        clusters: tags,
        root_cause: rc,
        intent: String(turn.normalizedIntent || ""),
      });
    }
  }

  const total = cases.length;
  const precision = total ? pass / total : 1;
  const rep = {
    harness_id: "silver_save_payload_precision_diagnostic_v1",
    cases_sampled: total,
    pass,
    fail: total - pass,
    payload_precision_accuracy: precision,
    cluster_breakdown: clusterCounts,
    root_cause_breakdown: rootCounts,
    top_fail_examples: topFails,
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2));

  console.log("=== SILVER_SAVE_PAYLOAD_PRECISION_DIAGNOSTIC_V1 ===");
  console.log("cases_sampled=" + total);
  console.log("payload_precision_accuracy=" + (precision * 100).toFixed(2) + "%");
  console.log("cluster_breakdown=" + JSON.stringify(clusterCounts));
  console.log("true_engine_bug_count=" + (rootCounts.true_engine_bug || 0));
  console.log("ambiguity_count=" + (rootCounts.ambiguity || 0));
  console.log("harness_problem_count=" + (rootCounts.harness_problem || 0));
  console.log("payload_contract_gap_count=" + (rootCounts.payload_contract_gap || 0));
  console.log("wrapper_contamination_count=" + (clusterCounts.wrapper_contamination || 0));
  console.log("field_ownership_fail_count=" + (clusterCounts.field_ownership_fail || 0));
  console.log("report_file=" + REPORT_JSON);
  console.log("=== END_SILVER_SAVE_PAYLOAD_PRECISION_DIAGNOSTIC_V1 ===");
}

if (require.main === module) main();
