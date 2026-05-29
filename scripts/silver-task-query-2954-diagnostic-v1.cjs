#!/usr/bin/env node
/**
 * silver-task-query-2954-diagnostic-v1.cjs — cluster all task_query 20k fails (2954/3000 lane).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const audit = require("./audit_silver_20000_routing_stable.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
const { foldCs } = require("./silver-calendar-no-diacritics-query-v1-shared.cjs");

const REPORT_JSON = path.join(__dirname, "silver-task-query-2954-diagnostic-report.json");

function classifyFail(c, ev, turn) {
  const f = foldCs(c.input);
  const eng = String(turn.normalizedIntent || "");
  const exp = String(c.expectedIntent || "");

  if (eng.indexOf("calendar") >= 0 && exp === "task.query") return "CALENDAR_STEAL_TASK_QUERY";
  if (eng.indexOf("calendar") >= 0 && exp === "unknown") return "CALENDAR_STEAL_UNKNOWN";
  if (eng.indexOf("note") >= 0 && (exp === "task.query" || exp === "unknown")) return "NOTE_STEAL";
  if (/\bbez\s+diakritiky\b/.test(f) && /\b(podivej|zjist)\w*\s+jen\s+do\s+ukol/.test(f) && /\bco\s+m(am|ame)\s+(?:na\s+)?dnes/.test(f)) {
    if (/\bne\s+v\s+kalend/.test(f) || /\bne\s+do\s+kalend/.test(f)) return "NO_DIACRITICS_TASK_READ_CONFLICT";
    return "NO_DIACRITICS_TASK_READ_CALENDAR_STEAL";
  }
  if (/\bne\s+v\s+kalend/.test(f) || /\bne\s+do\s+kalend/.test(f)) {
    if (/\b(podivej|zjist)\w*\s+jen\s+do\s+ukol/.test(f)) return "TASK_ONLY_NOT_CALENDAR_CONFLICT";
    if (/\bjen\s+ukol/.test(f)) return "TASK_ONLY_NOT_CALENDAR";
  }
  if (/\bmam\s+neco\s+o\b/.test(f) || /\bnajdi\s+ukol\b/.test(f)) return "TOPIC_TASK_QUERY_FAIL";
  if (/\b(kdy\s+mam|do\s+kdy\s+mam|dokdy\s+mam)\b/.test(f)) return "DUE_DATE_TASK_QUERY_FAIL";
  if (ev.cat === "query_created_write") return "CREATE_LEAK";
  if (exp === "unknown" && (eng === "tasks.read" || ev.auditIntent === "task.query")) return "UNKNOWN_EXPECTED_ENGINE_ROUTED";
  if (ev.cat === "intent_fail") return "TRUE_ENGINE_FAIL";
  return "OTHER_" + String(ev.cat || "intent_fail");
}

function main() {
  const eng = loadEngine();
  const cases = audit.buildCases().filter(function (c) {
    return c.group === "task_query";
  });
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
  const sortedClusters = Object.keys(clusters).sort(function (a, b) {
    return clusters[b] - clusters[a];
  });
  const uniquePatterns = {};
  for (let j = 0; j < fails.length; j++) {
    const norm = foldCs(fails[j].input)
      .replace(/\bbez\s+diakritiky:\s*/g, "")
      .slice(0, 100);
    uniquePatterns[norm] = (uniquePatterns[norm] || 0) + 1;
  }

  let trueEngine = 0;
  let goldProblem = 0;
  let harnessProblem = 0;
  let templateProblem = 0;
  for (let k = 0; k < sortedClusters.length; k++) {
    const ck = sortedClusters[k];
    const cnt = clusters[ck];
    if (
      ck.indexOf("STEAL") >= 0 ||
      ck.indexOf("TRUE_ENGINE") >= 0 ||
      ck.indexOf("NO_DIACRITICS") >= 0 ||
      ck.indexOf("CREATE_LEAK") >= 0 ||
      ck.indexOf("TOPIC") >= 0 ||
      ck.indexOf("DUE_DATE") >= 0
    ) {
      trueEngine += cnt;
    } else if (ck.indexOf("HARNESS") >= 0 || ck.indexOf("GOLD") >= 0) {
      goldProblem += cnt;
    } else if (ck.indexOf("TEMPLATE") >= 0) {
      templateProblem += cnt;
    } else if (ck.indexOf("CONFLICT") >= 0 && ck.indexOf("UNKNOWN") >= 0) {
      harnessProblem += cnt;
    } else {
      trueEngine += cnt;
    }
  }

  const report = {
    guard_id: "silver_task_query_2954_diagnostic_v1",
    group: "task_query",
    total: cases.length,
    pass: pass,
    fail: fails.length,
    clusters: clusters,
    unique_patterns: uniquePatterns,
    true_engine_fail_count: trueEngine,
    gold_problem_count: goldProblem,
    harness_problem_count: harnessProblem,
    template_problem_count: templateProblem,
    sample_fails: fails.slice(0, 80),
    PASS_FAIL: fails.length === 0 ? "PASS" : "FAIL"
  };

  try {
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  } catch (eW) {
    void eW;
  }

  console.log("=== TASK_QUERY_20K_FAIL_ANALYSIS ===");
  console.log("total_fails=" + fails.length);
  for (let ci = 0; ci < Math.max(sortedClusters.length, 1); ci++) {
    if (ci < sortedClusters.length) {
      console.log("cluster_" + (ci + 1) + "=" + sortedClusters[ci]);
      console.log("cluster_" + (ci + 1) + "_count=" + clusters[sortedClusters[ci]]);
    } else {
      console.log("cluster_" + (ci + 1) + "=(none)");
      console.log("cluster_" + (ci + 1) + "_count=0");
    }
  }
  for (let pad = sortedClusters.length; pad < 5; pad++) {
    console.log("cluster_" + (pad + 1) + "=(none)");
    console.log("cluster_" + (pad + 1) + "_count=0");
  }
  console.log("unique_patterns=" + JSON.stringify(uniquePatterns));
  console.log("true_engine_fail=" + trueEngine);
  console.log("gold_problem=" + goldProblem);
  console.log("harness_problem=" + harnessProblem);
  console.log("template_problem=" + templateProblem);
  console.log("=== END_TASK_QUERY_20K_FAIL_ANALYSIS ===");
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  process.exit(0);
}

if (require.main === module) main();
