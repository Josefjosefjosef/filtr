#!/usr/bin/env node
/**
 * SILVER_DEEP_PRODUCT_93_FOLLOWUP_DIAGNOSTIC_V1 — classify remaining deep-product fails.
 * Diagnostic only; uses full deep-product seed context + eval pipeline.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-deep-product-93-followup-diagnostic-v1-report.json");
const DEEP_REPORT = path.join(__dirname, "silver-deep-product-real-ux-v2-report.json");

const deep = require("./silver-deep-product-real-ux-v2.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, foldCs, cardType } = harness;

const DIRTY_CZECH_FAMILIES = [
  { key: "voice_self_correction", pattern: /\b(?:pardon|oprav|ne\s+zejtra|ne\s+zitra)\b/ },
  { key: "colloquial_shorthand", pattern: /\b(?:mrkni|hod\s+do|zejtra|v\s+tejdnu)\b/ },
  { key: "ascii_typos", pattern: /\b(?:prawnik|mame|zubar)\b/ },
  { key: "mam_tam_resil", pattern: /\b(?:mam\s+tam|co\s+sem\s+resil|kde\s+sem\s+mel)\b/ },
  { key: "vohledne_neco_s", pattern: /\b(?:vohledne|neco\s+s)\b/ },
];

function clusterKeyForFail(c, cat) {
  const k = String(cat || "fail");
  if (k === "retrieval_content_miss" || k === "false_negative") return "retrieval_dirty_czech";
  if (c.slice === "dirty_czech") return "retrieval_dirty_czech";
  if (k === "intent_fail" && (c.slice === "long_chaotic_czech" || c.slice === "timeline_reasoning")) {
    return "general_intent_mismatch";
  }
  if (k === "calendar_vs_task_confusion" && c.slice === "clarification_quality") return "ambiguity";
  if (k === "intent_fail") return "general_intent_mismatch";
  return "other";
}

function dirtyCzechFamily(input) {
  const f = foldCs(input);
  for (let i = 0; i < DIRTY_CZECH_FAMILIES.length; i++) {
    if (DIRTY_CZECH_FAMILIES[i].pattern.test(f)) return DIRTY_CZECH_FAMILIES[i].key;
  }
  return "other_dirty_czech";
}

function isCapabilityLeak(turn) {
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  return eng === "assistant.capability" || eng === "assistant.help" || eng === "assistant.guidance" || ps === "CAPABILITY_OK";
}

function isWriteTurn(turn) {
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  return (
    ps === "READY_TO_SAVE" ||
    eng === "calendar.create" ||
    eng === "tasks.create" ||
    eng === "notes.create"
  );
}

function classifyRow(c, turn, ev) {
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const fold = foldCs(c.input);

  if (ev.cat === "query_created_write" || ev.cat === "write_when_negated" || ev.cat === "negative_instruction_fail") {
    return { bucket: "safety_risk", true_engine: true, orchestration_leak: false, contamination: false, stale_context: false };
  }
  if (isCapabilityLeak(turn) && (c.slice === "timeline_reasoning" || /\bco\s+(?:jsem|sem)\s+(?:resil|mel|mela)\b/.test(fold))) {
    return { bucket: "true_engine_bug", true_engine: true, orchestration_leak: true, contamination: false, stale_context: false };
  }
  if (ev.cat === "retrieval_content_miss" && (eng === "calendar.read" || eng === "global.search")) {
    return { bucket: "retrieval_gap", true_engine: true, orchestration_leak: false, contamination: false, stale_context: false };
  }
  if (c.expectedIntent === "unknown" && (c.slice === "clarification_quality" || c.slice === "dirty_czech")) {
    if (eng === "clarification" || eng === "unknown" || ps === "NEEDS_CLARIFICATION") {
      return { bucket: "ambiguity", true_engine: false, orchestration_leak: false, contamination: false, stale_context: false };
    }
    if (ps === "READY_TO_SAVE" && (eng === "tasks.create" || eng === "calendar.create")) {
      return { bucket: "harness_problem", true_engine: false, orchestration_leak: false, contamination: false, stale_context: false };
    }
    return { bucket: "gold_label_problem", true_engine: false, orchestration_leak: false, contamination: false, stale_context: false };
  }
  if (ev.pass) {
    return { bucket: "harness_problem", true_engine: false, orchestration_leak: false, contamination: false, stale_context: false };
  }
  if (eng === "clarification" || eng === "unknown") {
    return { bucket: "ambiguity", true_engine: false, orchestration_leak: false, contamination: false, stale_context: false };
  }
  if (ev.cat === "calendar_vs_task_confusion" && c.slice === "clarification_quality") {
    return { bucket: "harness_problem", true_engine: false, orchestration_leak: false, contamination: false, stale_context: false };
  }
  if (isWriteTurn(turn) && c.group.indexOf("_query") >= 0) {
    return { bucket: "true_engine_bug", true_engine: true, orchestration_leak: true, contamination: false, stale_context: false };
  }
  if (ev.cat === "intent_fail" && c.slice === "timeline_reasoning") {
    return { bucket: "true_engine_bug", true_engine: true, orchestration_leak: false, contamination: false, stale_context: false };
  }
  return { bucket: "harness_problem", true_engine: false, orchestration_leak: false, contamination: false, stale_context: false };
}

function evaluateDeepCase(c, turn) {
  let ev;
  if (c.slice === "update_vs_create") {
    ev = { pass: true, cat: "", auditIntent: "non_create_ok", raw: harness.rawUserMessage(turn) };
  } else {
    ev = evaluateOne(
      { id: c.id, group: c.group, input: c.input, expectedIntent: c.expectedIntent, meta: c.meta || {} },
      turn
    );
  }
  ev = deep.evaluateClarificationQuality(c, turn, ev);
  ev = deep.evaluateDirtyCzechAmbiguity(c, turn, ev);
  if (ev.pass && c.retrievalNeedles && c.retrievalNeedles.length) {
    const fr = foldCs(ev.raw || "");
    const needleEv = deep.retrievalNeedlePass(fr, c.retrievalNeedles);
    if (!needleEv.ok) {
      ev = { pass: false, cat: needleEv.cat, auditIntent: ev.auditIntent, raw: ev.raw };
    }
  }
  return ev;
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
  const allCases = deep.expandCases();
  const byBase = {};
  for (let i = 0; i < allCases.length; i++) {
    const c = allCases[i];
    if (c.mutation_mask === 0 && !byBase[c.base_id]) byBase[c.base_id] = c;
  }

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
    orchestration_leak: 0,
    contamination: 0,
    stale_context: 0,
    safety_risk: 0,
  };
  const rootCauseBuckets = {};
  const sampleRows = [];
  const replayCandidates = [];
  const dirtyFamilies = {};
  const ambiguityFamilies = {};
  const seenBase = {};

  for (let i = 0; i < failRows.length; i++) {
    const row = failRows[i];
    const baseId = row.base_id || row.id;
    const c = byBase[baseId];
    if (!c) continue;

    let turn;
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
      turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), deep.ctxForCaseDeep(c));
    } catch {
      buckets.true_engine_bug++;
      buckets.safety_risk++;
      continue;
    }

    let ev;
    try {
      ev = evaluateDeepCase(c, turn);
    } catch {
      ev = { pass: false, cat: "runtime_fail", raw: "" };
    }

    const cluster = clusterKeyForFail(c, ev.cat);
    if (cluster === "general_intent_mismatch") buckets.general_intent_mismatch++;
    if (cluster === "retrieval_dirty_czech") buckets.retrieval_dirty_czech++;
    if (cluster === "ambiguity") buckets.ambiguity++;

    const cls = classifyRow(c, turn, ev);
    buckets[cls.bucket] = (buckets[cls.bucket] || 0) + 1;
    if (cls.true_engine) buckets.true_engine_bug++;
    if (cls.orchestration_leak) buckets.orchestration_leak++;
    if (cls.contamination) buckets.contamination++;
    if (cls.stale_context) buckets.stale_context++;

    const rootKey = cls.bucket + ":" + String(ev.cat || "pass");
    rootCauseBuckets[rootKey] = (rootCauseBuckets[rootKey] || 0) + 1;

    if (!seenBase[baseId]) {
      seenBase[baseId] = true;
      const sample = {
        base_id: baseId,
        slice: c.slice,
        input: c.input,
        expectedIntent: c.expectedIntent,
        normalizedIntent: turn.normalizedIntent,
        processingState: turn.processingState,
        cardKind: cardType(turn),
        harness_cat: ev.cat || "",
        pass: ev.pass,
        classification: cls.bucket,
        true_engine: cls.true_engine ? "YES" : "NO",
        response_snippet: String(ev.raw || "").slice(0, 200),
        replay: c.input,
      };
      sampleRows.push(sample);
      if (!ev.pass || cls.true_engine) {
        replayCandidates.push({ base_id: baseId, replay: c.input, fix_lane: cls.true_engine ? "engine" : "harness" });
      }
      if (c.slice === "dirty_czech") {
        const fam = dirtyCzechFamily(c.input);
        dirtyFamilies[fam] = (dirtyFamilies[fam] || 0) + 1;
      }
      if (c.slice === "clarification_quality" || c.expectedIntent === "unknown") {
        ambiguityFamilies[c.slice] = (ambiguityFamilies[c.slice] || 0) + 1;
      }
    }
  }

  const uniqueBaseCount = Object.keys(seenBase).length;
  const rep = {
    harness_id: "silver_deep_product_93_followup_diagnostic_v1",
    generated_at: new Date().toISOString(),
    main_commit: mainCommit,
    source_report: DEEP_REPORT,
    source_main_commit: deepRep ? deepRep.main_commit : null,
    total_fail_count: failRows.length,
    unique_base_fail_count: uniqueBaseCount,
    general_intent_mismatch: buckets.general_intent_mismatch,
    retrieval_dirty_czech: buckets.retrieval_dirty_czech,
    true_engine_bug_count: buckets.true_engine_bug,
    harness_problem_count: buckets.harness_problem,
    gold_label_problem_count: buckets.gold_label_problem,
    ambiguity_count: buckets.ambiguity,
    retrieval_gap_count: buckets.retrieval_gap,
    orchestration_leak_count: buckets.orchestration_leak,
    contamination_count: buckets.contamination,
    stale_context_count: buckets.stale_context,
    safety_risk_count: buckets.safety_risk,
    ready_for_engine_fix: buckets.true_engine_bug > 0 ? "YES" : "NO",
    ready_for_harness_alignment: buckets.harness_problem > 0 ? "YES" : "NO",
    ready_for_retrieval_fix: buckets.retrieval_gap > 0 ? "YES" : "NO",
    root_cause_buckets: rootCauseBuckets,
    sample_rows: sampleRows,
    replay_candidates: replayCandidates,
    dirty_czech_phrase_families: dirtyFamilies,
    retrieval_ambiguity_families: ambiguityFamilies,
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
  console.log("orchestration_leak_count=" + rep.orchestration_leak_count);
  console.log("contamination_count=" + rep.contamination_count);
  console.log("stale_context_count=" + rep.stale_context_count);
  console.log("safety_risk_count=" + rep.safety_risk_count);
  console.log("ready_for_engine_fix=" + rep.ready_for_engine_fix);
  console.log("ready_for_harness_alignment=" + rep.ready_for_harness_alignment);
  console.log("ready_for_retrieval_fix=" + rep.ready_for_retrieval_fix);
  console.log("sample_rows_count=" + sampleRows.length);
  console.log("replay_candidates_count=" + replayCandidates.length);
  console.log("PASS_FAIL=" + rep.PASS_FAIL);
  console.log("report=" + REPORT_JSON);
  console.log("=== END_SILVER_DEEP_PRODUCT_93_FOLLOWUP_DIAGNOSTIC_V1 ===");
}

if (require.main === module) main();
