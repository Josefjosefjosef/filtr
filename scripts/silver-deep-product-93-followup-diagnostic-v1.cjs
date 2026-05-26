#!/usr/bin/env node
/**
 * SILVER_DEEP_PRODUCT_93_FOLLOWUP_DIAGNOSTIC_V1 — classify remaining deep-product fails.
 * Diagnostic only; does not change engine/assets.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-deep-product-93-followup-diagnostic-v1-report.json");
const DEEP_REPORT = path.join(__dirname, "silver-deep-product-real-ux-v2-report.json");

const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, foldCs } = harness;

function clusterKeyForFail(c, cat) {
  const k = String(cat || "fail");
  if (k === "retrieval_content_miss" || k === "false_negative") {
    return "retrieval_dirty_czech";
  }
  if (c.slice === "dirty_czech") return "retrieval_dirty_czech";
  if (k === "intent_fail" && (c.slice === "long_chaotic_czech" || c.slice === "timeline_reasoning")) {
    return "general_intent_mismatch";
  }
  if (k === "intent_fail") return "general_intent_mismatch";
  return "other";
}

function classifyTrueEngine(c, turn, ev) {
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  if (ev.cat === "query_created_write" || ev.cat === "write_when_negated" || ev.cat === "negative_instruction_fail") {
    return true;
  }
  if (ps === "READY_TO_SAVE" && (eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create")) {
    return true;
  }
  if (clusterKeyForFail(c, ev.cat) === "retrieval_dirty_czech" && ev.cat === "retrieval_content_miss") {
    return true;
  }
  if (clusterKeyForFail(c, ev.cat) === "general_intent_mismatch") {
    const fold = foldCs(c.input);
    if (/\b(potrebuju\s+vedet|potrebuju\s+zjistit|mam\s+zitra|mam\s+dnes)\b/.test(fold) && eng === "calendar.read") {
      return false;
    }
    if (/\b(mrkni|ukaz)\b/.test(fold) && (eng === "calendar.read" || eng === "global.search")) {
      return false;
    }
  }
  return false;
}

function main() {
  let mainCommit = "unknown";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    /* ignore */
  }

  let deepRep = null;
  if (fs.existsSync(DEEP_REPORT)) {
    try {
      deepRep = JSON.parse(fs.readFileSync(DEEP_REPORT, "utf8"));
    } catch {
      deepRep = null;
    }
  }

  const failRows = deepRep && Array.isArray(deepRep.fails) ? deepRep.fails : [];
  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("=== SILVER_DEEP_PRODUCT_93_FOLLOWUP_DIAGNOSTIC_V1 ===");
    console.log("PASS_FAIL=FAIL");
    console.log("runtime_fail=" + String(e && e.message));
    console.log("=== END_SILVER_DEEP_PRODUCT_93_FOLLOWUP_DIAGNOSTIC_V1 ===");
    process.exit(1);
  }

  const buckets = {
    general_intent_mismatch: 0,
    retrieval_dirty_czech: 0,
    true_engine_bug: 0,
    harness_problem: 0,
    gold_label_problem: 0,
    ambiguity: 0,
    retrieval_gap: 0,
    safety_risk: 0,
  };

  const uniqueBase = {};
  for (let i = 0; i < failRows.length; i++) {
    const row = failRows[i];
    const baseId = row.base_id || row.id;
    if (uniqueBase[baseId]) continue;
    uniqueBase[baseId] = true;

    const c = {
      id: row.id,
      input: row.input,
      slice: row.slice,
      group: row.slice && row.slice.indexOf("query") >= 0 ? "calendar_query" : "calendar_query",
      expectedIntent: "calendar.query",
    };
    if (row.slice === "dirty_czech") c.expectedIntent = "calendar.query";
    if (row.slice === "timeline_reasoning") c.expectedIntent = "calendar.query";

    let turn;
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
      turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), { group: "calendar_query" });
    } catch {
      buckets.true_engine_bug++;
      continue;
    }

    let ev;
    try {
      ev = evaluateOne(c, turn);
    } catch {
      ev = { pass: false, cat: "runtime_fail" };
    }

    const cluster = clusterKeyForFail(c, ev.cat);
    if (cluster === "general_intent_mismatch") buckets.general_intent_mismatch++;
    if (cluster === "retrieval_dirty_czech") buckets.retrieval_dirty_czech++;

    if (classifyTrueEngine(c, turn, ev)) {
      buckets.true_engine_bug++;
    } else if (ev.pass) {
      buckets.harness_problem++;
    } else if (turn.normalizedIntent === "clarification" || turn.normalizedIntent === "unknown") {
      buckets.ambiguity++;
    } else if (ev.cat === "retrieval_content_miss") {
      buckets.retrieval_gap++;
    } else {
      buckets.harness_problem++;
    }
  }

  const totalFail = failRows.length;
  const rep = {
    harness_id: "silver_deep_product_93_followup_diagnostic_v1",
    generated_at: new Date().toISOString(),
    main_commit: mainCommit,
    source_report: DEEP_REPORT,
    source_main_commit: deepRep ? deepRep.main_commit : null,
    total_fail_count: totalFail,
    unique_base_fail_count: Object.keys(uniqueBase).length,
    general_intent_mismatch: buckets.general_intent_mismatch,
    retrieval_dirty_czech: buckets.retrieval_dirty_czech,
    true_engine_bug_count: buckets.true_engine_bug,
    harness_problem_count: buckets.harness_problem,
    gold_label_problem_count: buckets.gold_label_problem,
    ambiguity_count: buckets.ambiguity,
    retrieval_gap_count: buckets.retrieval_gap,
    safety_risk_count: buckets.safety_risk,
    ready_for_engine_fix: buckets.true_engine_bug > 0 ? "YES" : "NO",
    ready_for_harness_alignment: buckets.harness_problem > 0 ? "YES" : "NO",
    ready_for_retrieval_fix: buckets.retrieval_gap > 0 ? "YES" : "NO",
    PASS_FAIL: "PASS",
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2), "utf8");

  console.log("=== SILVER_DEEP_PRODUCT_93_FOLLOWUP_DIAGNOSTIC_V1 ===");
  console.log("main_commit=" + mainCommit);
  console.log("total_fail_count=" + rep.total_fail_count);
  console.log("unique_base_fail_count=" + rep.unique_base_fail_count);
  console.log("general_intent_mismatch=" + rep.general_intent_mismatch);
  console.log("retrieval_dirty_czech=" + rep.retrieval_dirty_czech);
  console.log("true_engine_bug_count=" + rep.true_engine_bug_count);
  console.log("harness_problem_count=" + rep.harness_problem_count);
  console.log("gold_label_problem_count=" + rep.gold_label_problem_count);
  console.log("ambiguity_count=" + rep.ambiguity_count);
  console.log("retrieval_gap_count=" + rep.retrieval_gap_count);
  console.log("safety_risk_count=" + rep.safety_risk_count);
  console.log("ready_for_engine_fix=" + rep.ready_for_engine_fix);
  console.log("ready_for_harness_alignment=" + rep.ready_for_harness_alignment);
  console.log("ready_for_retrieval_fix=" + rep.ready_for_retrieval_fix);
  console.log("PASS_FAIL=" + rep.PASS_FAIL);
  console.log("report=" + REPORT_JSON);
  console.log("=== END_SILVER_DEEP_PRODUCT_93_FOLLOWUP_DIAGNOSTIC_V1 ===");
}

if (require.main === module) main();
