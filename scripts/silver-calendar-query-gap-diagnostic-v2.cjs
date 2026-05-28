#!/usr/bin/env node
/**
 * silver-calendar-query-gap-diagnostic-v2.cjs — cluster remaining calendar_query 20k fails.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const audit = require("./audit_silver_20000_routing_stable.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_JSON = path.join(__dirname, "silver-calendar-query-gap-diagnostic-v2-report.json");

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function classifyFail(c, ev, turn) {
  const f = foldCs(c.input);
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const cat = String(ev.cat || "");

  if (cat === "query_created_write" || ps === "READY_TO_SAVE" || /create/.test(eng)) {
    return "READ_CREATE_CONFLICT";
  }
  if (cat === "write_when_negated") return "READ_CREATE_CONFLICT";
  if (ps === "STORAGE_DISAMBIGUATION") return "AMBIGUOUS_INPUT";
  if (/\ba\s+(ted|jeste|pak)\b/.test(f) || /\bjen\s+mi\s+to\b/.test(f)) return "STALE_CONTEXT";
  if (/\bneple\w*\s+(?:to\s+)?s\s+poznam/.test(f) && /\b(kalend|schuz)\b/.test(f)) return "MODULE_LEAK";
  if (/\bne\s+do\s+ukol/.test(f) && /\b(kalend|schuz)\b/.test(f)) return "MODULE_LEAK";
  if (/\b(v\s+ukol|do\s+ukol|v\s+poznam|do\s+poznam)\b/.test(f) && cat === "intent_fail") return "MODULE_LEAK";
  if (/\b(kdy\s+jsem|co\s+jsem\s+mel|co\s+jsem\s+resil|minul|vcera|zitra|dnes|vecer|rano)\b/.test(f) && cat === "intent_fail") {
    return "TEMPORAL_FAIL";
  }
  if (/\b(s\s+|s\s+kym|pep|novak|pravnik|doktor|zubar|servis)\b/.test(f) && cat === "intent_fail") {
    return "PERSON_ENTITY_FAIL";
  }
  if (/\bnajdi\b/.test(f) && /\b(adres|titul|entity)\b/.test(f)) return "RETRIEVAL_RANKING_FAIL";
  if (cat === "intent_fail" && (eng === "unknown" || eng === "clarification")) return "QUERY_SCOPE_FAIL";
  if (cat === "intent_fail") return "TRUE_ENGINE_FAIL";
  if (cat === "wrong_collection" || /note\.query|task\.query/.test(String(ev.auditIntent || ""))) {
    return "MODULE_LEAK";
  }
  return "TRUE_ENGINE_FAIL";
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
    if (fails.length < 400) {
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
  }

  const pass = cases.length - Object.values(clusters).reduce((a, b) => a + b, 0);
  const failCount = cases.length - pass;
  const topClusters = Object.keys(clusters)
    .sort((a, b) => clusters[b] - clusters[a])
    .map((k) => ({ cluster: k, count: clusters[k] }));

  const report = {
    guard_id: "silver_calendar_query_gap_diagnostic_v2",
    group: "calendar_query",
    total: cases.length,
    pass: pass,
    fail: failCount,
    remaining_calendar_query_fails: failCount,
    top_clusters: topClusters,
    true_engine_fail_count: clusters.TRUE_ENGINE_FAIL || 0,
    harness_problem_count: clusters.HARNESS_OR_GOLD || 0,
    ambiguous_input_count: clusters.AMBIGUOUS_INPUT || 0,
    stale_context_count: clusters.STALE_CONTEXT || 0,
    retrieval_ranking_count: clusters.RETRIEVAL_RANKING_FAIL || 0,
    entity_fail_count: clusters.PERSON_ENTITY_FAIL || 0,
    temporal_fail_count: clusters.TEMPORAL_FAIL || 0,
    module_leak_count: clusters.MODULE_LEAK || 0,
    read_create_conflict_count: clusters.READ_CREATE_CONFLICT || 0,
    query_scope_fail_count: clusters.QUERY_SCOPE_FAIL || 0,
    sample_fails: fails.slice(0, 40),
    PASS_FAIL: failCount === 0 ? "PASS" : "FAIL"
  };

  try {
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  } catch (eW) {
    void eW;
  }

  console.log("=== SILVER_CALENDAR_QUERY_GAP_DIAGNOSTIC_V2 ===");
  console.log("total=" + cases.length);
  console.log("pass=" + pass + "/" + cases.length);
  console.log("remaining_calendar_query_fails=" + failCount);
  console.log("top_clusters=" + JSON.stringify(topClusters.slice(0, 8)));
  console.log("true_engine_fail_count=" + (clusters.TRUE_ENGINE_FAIL || 0));
  console.log("module_leak_count=" + (clusters.MODULE_LEAK || 0));
  console.log("temporal_fail_count=" + (clusters.TEMPORAL_FAIL || 0));
  console.log("entity_fail_count=" + (clusters.PERSON_ENTITY_FAIL || 0));
  console.log("stale_context_count=" + (clusters.STALE_CONTEXT || 0));
  console.log("read_create_conflict_count=" + (clusters.READ_CREATE_CONFLICT || 0));
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_SILVER_CALENDAR_QUERY_GAP_DIAGNOSTIC_V2 ===");
  process.exit(0);
}

if (require.main === module) main();
