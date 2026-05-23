/**
 * Silver Conversation State V1 — foundation core (scripts-only).
 * Layer 6: last_module, pagination, continuation context.
 */
"use strict";

const CORE_ID = "silver_conversation_state_v1_core";

const { foldCs, parseSearchSemantics } = require("./silver-search-understanding-v1-core.cjs");

function createEmptyConversationState() {
  return {
    last_module: null,
    last_query: null,
    last_filter: null,
    last_results: [],
    last_result_count: 0,
    remaining_results: [],
    selected_item: null,
    continuation_context: null,
    pagination_state: {
      offset: 0,
      page_size: 10,
      total: 0,
      has_more: false,
    },
    updated_at: null,
  };
}

function moduleFromIntent(intent) {
  const s = String(intent || "");
  if (s.indexOf("calendar.") === 0) return "calendar";
  if (s.indexOf("tasks.") === 0) return "tasks";
  if (s.indexOf("notes.") === 0) return "notes";
  if (s === "global.search") return "global";
  return null;
}

function detectContinuationIntent(rawText) {
  const fold = foldCs(rawText);
  if (/\b(zbytek|zbyvajici|zbývající)\b/.test(fold)) return "remaining";
  if (/\b(dalsi|další|pokracuj|pokračuj|ukaz\s+dalsi|ukaž\s+další)\b/.test(fold)) return "next_page";
  if (/\b(ten\s+druhy|ten\s+druhý|ta\s+druha|ta\s+druhá|cislo\s+dva|číslo\s+dva)\b/.test(fold)) return "select_second";
  if (/\b(posledni|poslední|tu\s+posledni|tu\s+poslední)\b/.test(fold) && /\b(uprav|edit|zmen|změň)\b/.test(fold)) return "edit_last";
  if (/\b(jen\s+hotov|jen\s+aktivn|jen\s+pracovn)\b/.test(fold)) return "refine_filter";
  return null;
}

function updateConversationState(state, turn, rawText) {
  const next = Object.assign({}, state || createEmptyConversationState());
  const intent = String(turn.normalizedIntent || "");
  const mod = moduleFromIntent(intent);

  if (mod) next.last_module = mod;
  next.last_query = rawText;
  next.updated_at = new Date().toISOString();

  const semantics = parseSearchSemantics(rawText);
  if (semantics.filter) next.last_filter = semantics.filter;
  if (semantics.range) next.last_filter = semantics.range;

  const results = turn.searchResults || turn.results || [];
  if (Array.isArray(results) && results.length) {
    next.last_results = results.slice(0, 50);
    next.last_result_count = results.length;
    const pageSize = next.pagination_state.page_size || 10;
    if (results.length > pageSize) {
      next.remaining_results = results.slice(pageSize);
      next.pagination_state.has_more = true;
      next.pagination_state.total = results.length;
    } else {
      next.remaining_results = [];
      next.pagination_state.has_more = false;
      next.pagination_state.total = results.length;
    }
  }

  const cont = detectContinuationIntent(rawText);
  if (cont) next.continuation_context = cont;

  if (turn.draft && turn.draft.title) next.selected_item = turn.draft.title;

  return next;
}

function resolveContinuation(rawText, state) {
  const cont = detectContinuationIntent(rawText);
  if (!cont || !state) return null;

  const out = {
    kind: cont,
    module: state.last_module,
    prior_query: state.last_query,
    prior_filter: state.last_filter,
    remaining_count: (state.remaining_results || []).length,
    pagination: Object.assign({}, state.pagination_state),
  };

  if (cont === "remaining" || cont === "next_page") {
    out.expected_intent = state.last_module ? state.last_module + ".read" : "global.search";
    out.should_not_create = true;
  }
  if (cont === "refine_filter") {
    out.expected_intent = state.last_module ? state.last_module + ".read" : "global.search";
    out.inherit_query = true;
  }
  if (cont === "select_second" && state.last_results && state.last_results.length >= 2) {
    out.selected_index = 1;
    out.selected_item = state.last_results[1];
  }
  if (cont === "edit_last") {
    out.expected_intent = state.last_module ? state.last_module + ".update" : "clarification";
    out.selected_item = state.last_results && state.last_results.length ? state.last_results[state.last_results.length - 1] : state.selected_item;
  }
  return out;
}

function validateContinuationAlignment(rawText, state, turn) {
  const violations = [];
  const resolved = resolveContinuation(rawText, state);
  if (!resolved) return violations;

  const intent = String(turn.normalizedIntent || "");
  if (resolved.should_not_create && intent.indexOf(".create") >= 0) {
    violations.push("continuation_triggered_create");
  }
  if (resolved.expected_intent && intent !== resolved.expected_intent && intent !== "clarification") {
    if (!(resolved.kind === "refine_filter" && intent.indexOf(".read") >= 0)) {
      violations.push("continuation_wrong_intent");
    }
  }
  return violations;
}

module.exports = {
  CORE_ID,
  createEmptyConversationState,
  updateConversationState,
  detectContinuationIntent,
  resolveContinuation,
  validateContinuationAlignment,
  moduleFromIntent,
};
