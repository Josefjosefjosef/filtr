#!/usr/bin/env node
/**
 * silver-calendar-query-20k-2971-diagnostic-v1.cjs — cluster all calendar_query 20k fails.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const audit = require("./audit_silver_20000_routing_stable.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
const { foldCs } = require("./silver-calendar-no-diacritics-query-v1-shared.cjs");

const REPORT_JSON = path.join(__dirname, "silver-calendar-query-20k-2971-diagnostic-report.json");

function classifyFail(c, ev, turn) {
  const f = foldCs(c.input);
  const eng = String(turn.normalizedIntent || "");
  const exp = String(c.expectedIntent || "");

  if (exp === "unknown" && (eng === "calendar.read" || ev.auditIntent === "calendar.query")) {
    if (/\bne\s+v\s+kalend/.test(f) && /\b(podivej|co\s+mam|do\s+kalend|v\s+kalend)/.test(f)) {
      return "CONFLICT_NE_V_KALENDARI";
    }
    if (/\bale\s+ne\s+v\s+kalend/.test(f)) return "CONFLICT_ALE_NE_V_KALENDARI";
    return "UNKNOWN_EXPECTED_ENGINE_ROUTED";
  }
  if (/\bbez\s+diakritiky\b/.test(f) && ev.cat === "intent_fail") return "NO_DIACRITICS_INTENT_FAIL";
  if (/\bne\s+v\s+kalend/.test(f) && ev.cat === "intent_fail") return "NO_DIACRITICS_NEGATION_FAIL";
  if (/\b(zitra|dnes|pondel|tyden)\b/.test(f) && ev.cat === "intent_fail") return "TEMPORAL_ROUTING_FAIL";
  if (ev.cat === "intent_fail") return "TRUE_ENGINE_FAIL";
  if (ev.cat === "wrong_collection" || /note\.query|task\.query/.test(String(ev.auditIntent || ""))) {
    return "MODULE_LEAK";
  }
  if (ev.cat === "query_created_write") return "READ_CREATE_CONFLICT";
  return "OTHER_" + String(ev.cat || "intent_fail");
}

function clusterLabel(key) {
  return key;
}

function main() {
  const eng = loadEngine();
  const cases = audit.buildCases().filter((c) => c.group === "calendar_query");
  const fails = [];
  const clusters = {};

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), audit.ctxForCase(c.group));
    const ev = audit.evaluateOne(c, turn);
    if (ev.pass) continue;
    const cluster = classifyFail(c, ev, turn);
    clusters[cluster] = (clusters[cluster] || 0) + 1;
    fails.push({
      id: c.id,
      input: c.input,
      expected: c.expectedIntent,
      actual: ev.auditIntent,
      route: turn.normalizedIntent || "",
      reason: ev.cat,
      cluster: cluster
    });
  }

  const pass = cases.length - fails.length;
  const sortedClusters = Object.keys(clusters).sort((a, b) => clusters[b] - clusters[a]);
  const uniquePatterns = {};
  for (let j = 0; j < fails.length; j++) {
    const norm = foldCs(fails[j].input).replace(/\bbez\s+diakritiky:\s*/g, "").slice(0, 80);
    uniquePatterns[norm] = (uniquePatterns[norm] || 0) + 1;
  }

  let trueEngine = 0;
  let goldProblem = 0;
  let harnessProblem = 0;
  let templateProblem = 0;
  for (let k = 0; k < sortedClusters.length; k++) {
    const ck = sortedClusters[k];
    const cnt = clusters[ck];
    if (ck.indexOf("CONFLICT") >= 0 || ck === "TRUE_ENGINE_FAIL" || ck.indexOf("TEMPORAL") >= 0 || ck.indexOf("NO_DIACRITICS") >= 0) {
      trueEngine += cnt;
    } else if (ck.indexOf("HARNESS") >= 0 || ck.indexOf("GOLD") >= 0) {
      goldProblem += cnt;
    } else if (ck.indexOf("TEMPLATE") >= 0) {
      templateProblem += cnt;
    } else {
      harnessProblem += cnt;
    }
  }

  const report = {
    guard_id: "silver_calendar_query_20k_2971_diagnostic_v1",
    group: "calendar_query",
    total: cases.length,
    pass: pass,
    fail: fails.length,
    clusters: clusters,
    unique_patterns: uniquePatterns,
    true_engine_fail_count: trueEngine,
    gold_problem_count: goldProblem,
    harness_problem_count: harnessProblem,
    template_problem_count: templateProblem,
    sample_fails: fails.slice(0, 50),
    PASS_FAIL: fails.length === 0 ? "PASS" : "FAIL"
  };

  try {
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  } catch (eW) {
    void eW;
  }

  console.log("=== CALENDAR_QUERY_20K_FAIL_ANALYSIS ===");
  console.log("total_fails=" + fails.length);
  for (let ci = 0; ci < sortedClusters.length; ci++) {
    const label = clusterLabel(sortedClusters[ci]);
    console.log("cluster_" + (ci + 1) + "=" + label);
    console.log("cluster_" + (ci + 1) + "_count=" + clusters[sortedClusters[ci]]);
  }
  if (!sortedClusters.length) {
    console.log("cluster_1=(none)");
    console.log("cluster_1_count=0");
  }
  console.log("unique_patterns=" + JSON.stringify(uniquePatterns));
  console.log("true_engine_fail=" + trueEngine);
  console.log("gold_problem=" + goldProblem);
  console.log("harness_problem=" + harnessProblem);
  console.log("template_problem=" + templateProblem);
  console.log("=== END_CALENDAR_QUERY_20K_FAIL_ANALYSIS ===");
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  process.exit(0);
}

if (require.main === module) main();
