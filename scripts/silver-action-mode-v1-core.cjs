/**
 * Silver Action Mode V1 — SAVE vs SEARCH hard product layer (scripts + engine mirror).
 * SAVE MODE = structured draft card (calendar.create / tasks.create / notes.create)
 * SEARCH MODE = direct answer (read / query / global.search)
 */
"use strict";

const CORE_ID = "silver_action_mode_v1_core";

const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const searchCore = require("./silver-search-understanding-v1-core.cjs");

const CREATE_INTENTS = ["calendar.create", "tasks.create", "notes.create"];
const SEARCH_INTENTS = ["calendar.read", "calendar.query", "tasks.read", "tasks.query", "notes.read", "notes.query", "global.search"];
const UPDATE_INTENTS = ["calendar.update", "tasks.update", "notes.update"];

function foldCs(s) {
  return payloadCore.foldCs(s);
}

function isCreateIntent(intent) {
  return CREATE_INTENTS.indexOf(String(intent || "")) >= 0;
}

function isExplicitNotesCreateContext(rawText) {
  const fold = foldCs(rawText);
  return (
    payloadCore.isNotesModuleContext(rawText) ||
    (/\b(uloz|ulo[zž]|pridej|p[rř]idej|zapis|zapi[sš]|hod\s+mi|dej\s+mi)\b/.test(fold) &&
      /\b(do\s+)?poznam/i.test(fold))
  );
}

function isSearchIntent(intent) {
  const ni = String(intent || "");
  if (SEARCH_INTENTS.indexOf(ni) >= 0) return true;
  return ni.indexOf(".read") > 0 || ni.indexOf(".query") > 0;
}

function hasSearchCue(fold) {
  return (
    /\b(kdy|kolik|vypis|vypi[sš]|ukaz|uka[zž]|najdi|hledej|vyhledej|co\s+m[aá]m|jak[eé]\s+m[aá]m|kde\s+m[aá]m|kde\s+je|kde\s+m[aá]|zbytek|zbyvaj|dal[sš][ií]|pokracuj|pokra[cč]uj)\b/.test(fold) ||
    /\b(jen\s+hotov|hotov[eé]\s+[uú]kol|aktivn[ií]\s+[uú]kol|dokoncen|dokon[cč]en)\b/.test(fold)
  );
}

function hasCreateCue(fold, rawText) {
  const raw = String(rawText || "");
  return (
    /\b(uloz|ulo[zž]|pridej|p[rř]idej|vytvor|vytvo[rř]|zapis|zapi[sš]|hod\s+mi|dej\s+mi|pripomen|p[rř]ipome[nň]|nov[aá]\s+pozn[aá]mk)\b/.test(fold) ||
    payloadCore.NOTES_MODULE_CUES.some(function (re) {
      return re.test(raw);
    })
  );
}

/**
 * Deterministic action mode from raw text + optional turn hint.
 * Returns: save | search | update | clarification
 */
function iuSilverDetermineActionModeV1(rawText, turnOpt) {
  const turn = turnOpt || {};
  const ni = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const fold = foldCs(rawText);

  if (ni.indexOf(".update") > 0 || UPDATE_INTENTS.indexOf(ni) >= 0) return "update";
  if (ni === "clarification" || ni === "unknown" || ps === "CLARIFICATION") return "clarification";
  if (ps === "STORAGE_DISAMBIGUATION" || turn.storageDisambiguation) return "clarification";

  if (isSearchIntent(ni) || ps === "READ_OK") return "search";
  if (isCreateIntent(ni) || ps === "READY_TO_SAVE" || ps === "NEEDS_CLARIFICATION") {
    if (isCreateIntent(ni)) return "save";
  }

  if (hasSearchCue(fold) && !hasCreateCue(fold, rawText)) return "search";
  if (
    hasCreateCue(fold, rawText) &&
    !/\b(kdy|kolik|vypis|vypi[sš]|najdi|hledej|co\s+m[aá]m|jak[eé]\s+m[aá]m)\b/.test(fold)
  ) {
    return "save";
  }

  const scope = payloadCore.detectModuleScope(rawText);
  if (scope.indexOf(".read") > 0 || scope === "global.search") return "search";
  if (scope.indexOf(".create") > 0) return "save";

  const semantics = searchCore.parseSearchSemantics(rawText);
  if (semantics.isCount || semantics.isList || semantics.isContinuation || semantics.filter) return "search";

  return "clarification";
}

function turnHasStructuredDraftCard(turn) {
  const t = turn || {};
  const ni = String(t.normalizedIntent || "");
  const d = t.draft || {};
  const tc = String(d.targetContainer || "");
  if (!isCreateIntent(ni)) return false;
  if (tc === "calendar") return true;
  if (tc === "tasks" && String(d.title || "").trim()) return true;
  if (tc === "notes" && String(d.silverNoteText || "").trim()) return true;
  return false;
}

function turnHasDraftCardArtifact(turn) {
  const t = turn || {};
  const d = t.draft || {};
  const tc = String(d.targetContainer || "");
  if (tc === "calendar" || tc === "tasks" || tc === "notes") return true;
  if (t.processingState === "READY_TO_SAVE" || t.processingState === "NEEDS_CLARIFICATION") {
    return isCreateIntent(t.normalizedIntent);
  }
  return false;
}

function turnIsDirectSearchAnswer(turn) {
  const t = turn || {};
  if (t.readAnswer && String(t.readAnswer.message || "").trim()) return true;
  if (t.processingState === "READ_OK") return true;
  return isSearchIntent(t.normalizedIntent);
}

function suppressSearchAnswerDuplicates(message) {
  let s = String(message || "").trim();
  if (!s) return s;
  const sep = s.match(/\s+[—–-]\s+/);
  if (sep) {
    const parts = s.split(/\s+[—–-]\s+/);
    if (parts.length === 2 && foldCs(parts[0]) === foldCs(parts[1].replace(/\.\s*$/, ""))) {
      return parts[0].trim() + (/\.\s*$/.test(parts[1]) ? "." : "");
    }
  }
  const dupTail = s.match(/^(.+?)\s+\1\s*\.?\s*$/i);
  if (dupTail) return dupTail[1].trim() + (s.endsWith(".") ? "." : "");
  return s;
}

function validateSaveSearchTurn(turn, rawText) {
  const violations = [];
  const mode = iuSilverDetermineActionModeV1(rawText, turn);
  const ni = String(turn.normalizedIntent || "");

  if (mode === "save" && isCreateIntent(ni)) {
    if (!turnHasStructuredDraftCard(turn)) violations.push("create_without_structured_draft_card");
    if (turnIsDirectSearchAnswer(turn) && !turnHasStructuredDraftCard(turn)) {
      violations.push("create_direct_answer_without_card");
    }
    if (turn.confirmOnly) violations.push("create_confirm_only_without_card");
  }

  if (mode === "search" || isSearchIntent(ni)) {
    if (turnHasDraftCardArtifact(turn) && !turn.silverMultiIntentComposite) {
      violations.push("query_with_draft_card");
    }
    if (isCreateIntent(ni)) violations.push("query_routed_as_create");
    if (!turnIsDirectSearchAnswer(turn) && !turn.silverMultiIntentComposite) {
      violations.push("search_missing_direct_answer");
    }
  }

  const msg = turn.readAnswer && turn.readAnswer.message ? turn.readAnswer.message : "";
  if (msg) {
    const clean = suppressSearchAnswerDuplicates(msg);
    if (foldCs(msg) !== foldCs(clean) && msg.indexOf(" — ") >= 0) violations.push("search_answer_duplicate_content");
  }

  if (payloadCore.isEventNoteContext(rawText) && ni === "notes.create" && !isExplicitNotesCreateContext(rawText)) {
    violations.push("event_note_vs_notes_create");
  }
  if (payloadCore.isTaskNoteContext(rawText) && ni === "notes.create" && !isExplicitNotesCreateContext(rawText)) {
    violations.push("task_note_vs_note_body");
  }

  return { mode, pass: violations.length === 0, violations };
}

function cardTypeFromTurn(turn) {
  const ps = turn.processingState;
  const ni = turn.normalizedIntent;
  const d = turn.draft || {};
  if (ps === "STORAGE_DISAMBIGUATION") return "storage_disambiguation";
  if (ps === "READ_OK" || isSearchIntent(ni)) return "read_card";
  if (ni === "global.search" && turn.readAnswer) return "search_read";
  if (d.targetContainer === "tasks") return "task_draft";
  if (d.targetContainer === "notes") return "note_draft";
  if (d.targetContainer === "calendar" || ni === "calendar.create") return "calendar_draft";
  if (ps === "CLARIFICATION") return "clarification";
  return ni || ps || "none";
}

module.exports = {
  CORE_ID,
  CREATE_INTENTS,
  SEARCH_INTENTS,
  UPDATE_INTENTS,
  foldCs,
  iuSilverDetermineActionModeV1,
  turnHasStructuredDraftCard,
  turnHasDraftCardArtifact,
  turnIsDirectSearchAnswer,
  suppressSearchAnswerDuplicates,
  validateSaveSearchTurn,
  cardTypeFromTurn,
  isCreateIntent,
  isSearchIntent,
  isExplicitNotesCreateContext,
};
