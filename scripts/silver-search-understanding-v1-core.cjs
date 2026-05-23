/**
 * Silver Search Understanding Engine V1 — foundation core (scripts-only).
 * Layer 5: count / list / filter / continue / pagination semantics.
 */
"use strict";

const CORE_ID = "silver_search_understanding_v1_core";

const SEARCH_MODES = ["count", "list", "filter", "search", "continue", "full_list", "remaining"];
const TIME_RANGES = ["today", "tomorrow", "next_week", "last_occurrence", "future", "past"];
const TASK_FILTERS = ["completed", "active"];

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function detectSearchMode(fold) {
  if (/\b(kolik|pocet|počet|kolikrat|kolikrát)\b/.test(fold)) return "count";
  if (/\b(vypis\s+vsech|vypiš\s+všech|vsech\s+\d+|všech\s+\d+|full\s+list)\b/.test(fold)) return "full_list";
  if (/\b(zbytek|zbyvajici|zbývající|dalsi|další|pokracuj|pokračuj|pokracovani|pokračování)\b/.test(fold)) return "continue";
  if (/\b(zbyva|zbývá|remaining)\b/.test(fold)) return "remaining";
  if (/\b(jen\s+hotov|jen\s+aktivn|jen\s+pracovn|filter|filtr)\b/.test(fold)) return "filter";
  if (/\b(vypis|vypiš|seznam|ukaz|ukaž|list)\b/.test(fold)) return "list";
  return "search";
}

function detectTimeRange(fold) {
  if (/\b(dnes|dneska)\b/.test(fold)) return "today";
  if (/\b(zitra|zítra)\b/.test(fold)) return "tomorrow";
  if (/\b(pristi\s+tyden|příští\s+týden|prijisti\s+tyden)\b/.test(fold)) return "next_week";
  if (/\b(posledni|poslední|naposled)\b/.test(fold)) return "last_occurrence";
  if (/\b(budouc|prijde|přijde|prijde)\b/.test(fold)) return "future";
  if (/\b(minul|vcera|včera|bylo)\b/.test(fold)) return "past";
  return "";
}

function detectTaskFilter(fold) {
  if (/\b(hotov|splnen|splněn|dokoncen|dokončen|completed)\b/.test(fold)) return "completed";
  if (/\b(aktivn|otevren|otevřen|nedokoncen|nedokončen|active)\b/.test(fold)) return "active";
  if (/\b(pracovn)\b/.test(fold)) return "active";
  return "";
}

function detectModule(fold) {
  if (/\b(ukol|ukoly|úkol|úkoly|task)\b/.test(fold)) return "tasks";
  if (/\b(poznamk|poznámk|note)\b/.test(fold)) return "notes";
  if (/\b(schuzk|schůzk|kalend|udalost|událost|schuzku)\b/.test(fold)) return "calendar";
  return "global";
}

function detectLimit(fold) {
  const m = fold.match(/\b(vsech|všech)\s+(\d+)\b/);
  if (m) return { kind: "all", count: parseInt(m[2], 10) };
  if (/\b(vsechny|všechny|vsech|všech)\b/.test(fold)) return { kind: "all", count: null };
  return { kind: "default", count: null };
}

function parseSearchSemantics(rawText) {
  const fold = foldCs(rawText);
  const mode = detectSearchMode(fold);
  const range = detectTimeRange(fold);
  const filter = detectTaskFilter(fold);
  const module = detectModule(fold);
  const limit = detectLimit(fold);
  const intent = module === "global" ? "global.search" : module + ".read";
  return {
    module,
    intent,
    mode,
    range,
    filter,
    limit,
    isContinuation: mode === "continue" || mode === "remaining",
    isCount: mode === "count",
    isList: mode === "list" || mode === "full_list",
  };
}

function validateSearchModeAlignment(turn, semantics) {
  const violations = [];
  const intent = String(turn.normalizedIntent || "");
  const reply = String(turn.assistantReply || turn.reply || "");

  if (semantics.isCount && /\b\d+\s+(schuz|schůz|ukol|úkol|poznam|poznám)/i.test(reply) && reply.split("\n").length > 3) {
    violations.push("count_query_returned_list");
  }
  if (semantics.isList && /^\s*\d+\s*$/.test(reply.trim()) && reply.trim().length < 4) {
    violations.push("list_query_returned_count_only");
  }
  if (semantics.filter === "completed" && intent === "tasks.read" && /\b(aktivn|otevren|otevřen)\b/i.test(reply)) {
    violations.push("completed_filter_returned_active");
  }
  if (semantics.range === "next_week" && /\b(dnes|dneska)\b/i.test(reply) && !/\b(pristi|příští)\b/i.test(reply)) {
    violations.push("next_week_query_returned_today");
  }
  if (semantics.isContinuation && intent.indexOf(".create") > 0) {
    violations.push("continue_query_started_new_search");
  }
  return violations;
}

module.exports = {
  CORE_ID,
  SEARCH_MODES,
  TIME_RANGES,
  TASK_FILTERS,
  foldCs,
  parseSearchSemantics,
  detectSearchMode,
  detectTimeRange,
  detectTaskFilter,
  detectModule,
  validateSearchModeAlignment,
};
