#!/usr/bin/env node
/**
 * SILVER_RETRIEVAL_FALSE_NEGATIVE_DIAGNOSTIC_V2 — classify retrieval false negatives by root cause family.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-retrieval-false-negative-diagnostic-v1-report.json");
const corpus = require("./silver-search-read-retrieval-mastery-3500-corpus-v1.cjs");
const mastery = require("./silver-search-read-retrieval-mastery-3500-audit-v1.cjs");
const actionCore = require("./silver-action-mode-v1-core.cjs");
const searchCore = require("./silver-search-understanding-v1-core.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, foldCs } = harness;

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function ctxForFixtures() {
  const f = corpus.FIXTURES;
  return {
    now: corpus.FIXED_NOW,
    getEventsSnapshot: function () {
      return f.events;
    },
    getTasksSnapshot: function () {
      return f.tasks;
    },
    getNotesSnapshot: function () {
      return f.notes;
    },
  };
}

function messageOf(turn) {
  return String(
    (turn.readAnswer && turn.readAnswer.message) ||
      turn.assistantLead ||
      turn.userFacingSummary ||
      ""
  );
}

function classifyFamily(input, issues, expected) {
  const f = foldCs(input);
  const top = issues[0] || "unknown";
  if (top === "query_created_write" || top === "query_with_draft_card") return top;
  if (top === "wrong_module") return "cross_module_suppression_fail";
  if (top === "clarification_overfire") return "harness_gold_mismatch";
  if (/\b(ee|no|prost[eě]|hele|vole|teda)\b/.test(f) && f.length >= 12) return "chaotic_prefix_fail";
  if (/\b(ee|no|prost[eě])\s+\w/.test(f)) return "mobile_speech_fail";
  if (/\bkolem\b|\bvsude\b|\bvsechno\b|\bcokoliv\b|\bnapric\b/.test(f)) return "global_search_rank_fail";
  if (/\bpep\w*\b/.test(f)) return "pepa_alias_fail";
  if (/\bkub\w*\b/.test(f)) return "kuba_alias_fail";
  if (/\baut\w*\b|\bautomobil\b|\bvuz\b/.test(f)) return "auto_semantic_fail";
  if (/\btv\b|\bteleviz/.test(f)) return "tv_semantic_fail";
  if (/\bpravnik\b|\badvokat\b/.test(f)) return "pravnik_semantic_fail";
  if (/\bfaktur/.test(f)) return "faktura_semantic_fail";
  if (/\bnajem\b|\bnajemne\b/.test(f)) return "najem_semantic_fail";
  if (/\bpin\b|\bkod\b|\bheslo\b/.test(f)) return "pin_kod_fail";
  if (/\bzaruk\b|\breklamac/.test(f)) return "zaruka_reklamace_fail";
  if (/\bpojist/.test(f)) return "pojistka_fail";
  if (/\bminul|\bvcera|\bdnes|\bzitra|\bpristi\b|\bbudouc|\btyden\b/.test(f)) return "temporal_relevance_fail";
  if (/\btermin\b|\bdeadline\b|\bdokdy\b/.test(f)) return "deadline_retrieval";
  if (/\bkolik\b/.test(f)) return "aggregate_scope_fail";
  if (expected && expected.section === "calendar") return "semantic_calendar_retrieval";
  if (expected && expected.section === "tasks") return "semantic_task_retrieval";
  if (expected && expected.section === "notes") return "semantic_note_retrieval";
  if (expected && expected.section === "global") return "mixed_retrieval";
  if (top === "false_negative_retrieval") return "semantic_relevance_fail";
  if (top === "entity_matching_fail") return "entity_missing";
  if (top === "alias_normalization_fail" || top === "czech_declension_fail") return "alias_chain_fail";
  return "semantic_relevance_fail";
}

function classifyRootCause(issues, family, sr, exp) {
  if (issues.indexOf("query_created_write") >= 0) return "engine_write_leak";
  if (issues.indexOf("query_with_draft_card") >= 0) return "engine_draft_card_leak";
  if (issues.indexOf("wrong_module") >= 0) return "cross_module_suppression_fail";
  if (issues.indexOf("clarification_overfire") >= 0) return "missing_read_route";
  if (family === "temporal_relevance_fail") return "temporal_relevance_fail";
  if (family === "deadline_retrieval" || family === "deadline_fail") return "deadline_engine_gap";
  if (family === "global_search_rank_fail") return "global_search_rank_fail";
  if (family === "aggregate_scope_fail") return "aggregate_scope_fail";
  if (family === "faktura_semantic_fail") return "wrong_candidate_rank";
  if (family === "chaotic_prefix_fail" || family === "mobile_speech_fail") return "human_noise_fail";
  if (!sr || !sr.results || !sr.results.length) {
    if (issues.indexOf("false_negative_retrieval") >= 0) return "retrieval_window_fail";
    return "semantic_relevance_fail";
  }
  if (sr.bestResult && sr.bestResult.score < 40) return "weak_token_weight";
  if (exp && exp.entity && issues.indexOf("entity_matching_fail") >= 0) return "entity_missing";
  if (issues.indexOf("false_negative_retrieval") >= 0) return "wrong_candidate_rank";
  return "semantic_relevance_fail";
}

function suggestFix(family, root) {
  const map = {
    semantic_relevance_fail: "Retrieval Relevance Engine V5: context + cross-hit reinforcement",
    weak_token_weight: "Weighted Token Search: entity boost + weak token decay",
    alias_chain_fail: "Retrieval Normalization Registry alias chain reinforcement",
    entity_missing: "Semantic entity clustering + registry expand",
    wrong_candidate_rank: "Semantic Retrieval Ranking V5 relevance tie-breaks",
    weak_context_merge: "Context reinforcement from rawFoldedHint",
    aggregate_scope_fail: "Aggregate Retrieval scope router",
    global_search_rank_fail: "GlobalSearchOrchestratorV2 cross-module merge",
    temporal_relevance_fail: "TemporalQueryResolver + calendar agenda routing",
    fuzzy_czech_fail: "iuSilverNormalizeForSearch declension reps",
    no_diacritics_fail: "Retrieval Normalization Registry apply",
    human_noise_fail: "Human filler suppression in normalize",
    retrieval_window_fail: "Explicit Query Scope Router + early read turn",
    cross_module_suppression_fail: "CrossModuleQueryRouterV1 module lock",
    harness_gold_mismatch: "harness/gold mismatch review",
    deadline_fail: "Task Deadline Retrieval V4 list + stem match",
    deadline_retrieval: "Task Deadline Retrieval V4 list + stem match",
    pepa_alias_fail: "registry pepa declension group",
    auto_semantic_fail: "synonym expand auto + calendar find_by_title",
    semantic_calendar_retrieval: "calendar find_by_title / agenda_for_day narrow fix",
    semantic_task_retrieval: "task deadline V4 + searchLocalData tasks",
    semantic_note_retrieval: "notes alias chain + entity boost",
    mixed_retrieval: "GlobalSearchOrchestratorV2 entity retry",
    faktura_semantic_fail: "faktura entity boost + cross-record merge",
    chaotic_prefix_fail: "Human filler suppression + mobile prefix cleanup",
    mobile_speech_fail: "Spoken Czech cleanup in normalizeForSearch",
  };
  return map[root] || map[family] || "narrow retrieval family fix in app.js";
}

function tokenWeights(toks) {
  const w = {};
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    w[t] = t.length >= 5 ? 3 : t.length >= 4 ? 2 : 1;
  }
  return w;
}

function aliasChainPath(normQ) {
  const parts = String(normQ || "").split(/\s+/).filter(function (x) {
    return x.length >= 2;
  });
  return parts.slice(0, 6);
}

function temporalRelevanceReason(family, sr) {
  if (family !== "temporal_relevance_fail") return "";
  const tr = searchCore.parseSearchSemantics ? searchCore.parseSearchSemantics("") : null;
  void tr;
  if (sr && sr.readQuery && sr.readQuery.intent) return "calendar_structured:" + sr.readQuery.intent;
  return "temporal_agenda_or_count_route_missing";
}

function semanticRelevanceReason(family, root) {
  if (family.indexOf("semantic") >= 0 || root === "wrong_candidate_rank") {
    return family + ":" + root;
  }
  return "";
}

function whyCandidateLost(sr, exp) {
  if (!sr || !sr.results || !sr.results.length) return "no_candidates_in_window";
  const best = sr.bestResult;
  if (!best) return "empty_best_result";
  const msgNeed = exp && exp.mustContain ? exp.mustContain.join("|") : exp && exp.entity ? exp.entity : "";
  if (msgNeed && best.payload) return "best_candidate_missed_must_contain:" + msgNeed;
  if (best.score < 40) return "weak_token_weight_below_threshold";
  return "wrong_candidate_ranked_first";
}

function crossRecordReinforcement(sr) {
  if (!sr || !Array.isArray(sr.results)) return false;
  return sr.results.length >= 2 && sr.source === "global_orchestrator_v2";
}

function confidenceScore(sr) {
  if (!sr) return 0;
  if (typeof sr.confidence === "number") return sr.confidence;
  if (sr.bestResult && sr.bestResult.score) return Math.min(1, (sr.bestResult.score || 0) / 200);
  return 0;
}

function retrievalRankDelta(sr) {
  if (!sr || !Array.isArray(sr.results) || sr.results.length < 2) return 0;
  const a = sr.results[0] ? sr.results[0].score || 0 : 0;
  const b = sr.results[1] ? sr.results[1].score || 0 : 0;
  return a - b;
}

function finalRankingExplanation(family, root, sr) {
  const conf = confidenceScore(sr);
  const delta = retrievalRankDelta(sr);
  return (
    "family=" +
    family +
    ";root=" +
    root +
    ";confidence=" +
    conf.toFixed(3) +
    ";rank_delta=" +
    delta +
    ";cross_record=" +
    (crossRecordReinforcement(sr) ? "yes" : "no")
  );
}

function runDiagnostic(eng) {
  const ctx = ctxForFixtures();
  const cases = corpus.ALL_CASES;
  const families = {};
  const rootCauses = {};
  const fails = [];
  let falseNegative = 0;
  let semanticRelevanceFail = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const ev = mastery.evaluateCase(c, turn);
    if (ev.pass) continue;

    if (
      ev.cluster !== "false_negative_retrieval" &&
      ev.issues.indexOf("false_negative_retrieval") < 0 &&
      ev.issues.indexOf("search_missing_answer") < 0
    ) {
      continue;
    }

    falseNegative++;
    const msg = messageOf(turn);
    const family = classifyFamily(c.input, ev.issues, { section: c.section, entity: c.expected.entity });
    const sr = turn.silverSearchResult || (turn.readAnswer && turn.readAnswer.silverSearch) || null;
    const root = classifyRootCause(ev.issues, family, sr, c.expected);
    families[family] = (families[family] || 0) + 1;
    rootCauses[root] = (rootCauses[root] || 0) + 1;
    if (root === "semantic_relevance_fail" || family.indexOf("semantic") >= 0) semanticRelevanceFail++;

    const normQ = sr && sr.normalizedQuery ? sr.normalizedQuery : foldCs(c.input);
    const toks = normQ.split(/\s+/).filter(function (x) {
      return x.length >= 2;
    });
    const topCandidates = [];
    if (sr && Array.isArray(sr.results)) {
      for (let ri = 0; ri < Math.min(sr.results.length, 5); ri++) {
        const row = sr.results[ri];
        let label = row.kind || "";
        if (row.payload && row.payload.event) label += ":" + String(row.payload.event.title || "").slice(0, 40);
        else if (row.payload && row.payload.task) label += ":" + String(row.payload.task.title || "").slice(0, 40);
        else if (row.payload && row.payload.note) label += ":" + String(row.payload.note.title || "").slice(0, 40);
        topCandidates.push({ kind: label, score: row.score || 0 });
      }
    }

    if (fails.length < 120) {
      fails.push({
        id: c.id,
        input: c.input,
        expected: c.expected.module,
        actual: turn.normalizedIntent,
        normalized_query: normQ,
        matched_tokens: toks.slice(0, 8),
        missing_tokens: c.expected.entity ? [c.expected.entity] : [],
        token_weights: tokenWeights(toks),
        top_ranked_candidates: topCandidates,
        rejected_candidates: [],
        confidence_score: confidenceScore(sr),
        retrieval_rank_delta: retrievalRankDelta(sr),
        why_candidate_lost: whyCandidateLost(sr, c.expected),
        semantic_relevance_reason: semanticRelevanceReason(family, root),
        temporal_relevance_reason: temporalRelevanceReason(family, sr),
        alias_chain_path: aliasChainPath(normQ),
        cross_record_reinforcement: crossRecordReinforcement(sr),
        final_ranking_explanation: finalRankingExplanation(family, root, sr),
        ranking_score: sr && sr.bestResult ? sr.bestResult.score || 0 : 0,
        ranking_reason: root,
        semantic_family: family,
        root_cause: root,
        suggested_narrow_fix: suggestFix(family, root),
        issues: ev.issues,
        msg: msg.slice(0, 200),
      });
    }
  }

  const topFamilies = Object.keys(families)
    .sort(function (a, b) {
      return families[b] - families[a];
    })
    .slice(0, 12)
    .map(function (k) {
      return { family: k, count: families[k] };
    });

  return {
    harness_id: "silver_retrieval_false_negative_diagnostic_v2",
    main_commit: mainCommit(),
    total_cases: cases.length,
    retrieval_false_negative_count: falseNegative,
    semantic_relevance_fail_count: semanticRelevanceFail,
    top_fail_families: topFamilies,
    root_cause_counts: rootCauses,
    fails: fails,
  };
}

function main() {
  const eng = loadEngine();
  const report = runDiagnostic(eng);
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  console.log("=== SILVER_RETRIEVAL_FALSE_NEGATIVE_DIAGNOSTIC_V1 ===");
  console.log("retrieval_false_negative_count=" + report.retrieval_false_negative_count);
  console.log("semantic_relevance_fail_count=" + report.semantic_relevance_fail_count);
  console.log("top_fail_families=" + JSON.stringify(report.top_fail_families.slice(0, 5)));
  console.log("report=" + REPORT_JSON);
  console.log("=== END_SILVER_RETRIEVAL_FALSE_NEGATIVE_DIAGNOSTIC_V1 ===");
}

if (require.main === module) main();

module.exports = { runDiagnostic };
