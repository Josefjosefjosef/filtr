/**
 * SAVE UNDERSTANDING VALIDATOR + REPAIR PASS V1 — scripts mirror (audit/governance).
 */
"use strict";

const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");

const CORE_ID = "silver_save_understanding_validator_repair_v1_core";

const { foldCs, stripInstructionPrefixes, stripAssistantInvocation, cleanReminderNote, cleanTaskNote } =
  payloadCore;

function draftField(turn, name) {
  return validator.draftField(turn, name);
}

function hasTemporalInTitleWhenSlotsFilled(turn) {
  const d = turn && turn.draft ? turn.draft : {};
  const title = foldCs(draftField(turn, "title"));
  if (!title) return false;
  const hasDate = d.meta && d.meta.date === "certain";
  const hasTime = d.meta && d.meta.time === "certain";
  if (!hasDate && !hasTime) return false;
  return (
    /\b(zitra|zejtra|dnes|pristi|pondel|utery|stred|ctvrtek|patek)\b/.test(title) ||
    /\bkolem\b/.test(title) ||
    /\bv\s+\d{1,2}/.test(title)
  );
}

function hasLocationInTitleWhenLocFilled(turn) {
  const title = foldCs(draftField(turn, "title"));
  const loc = foldCs(draftField(turn, "location"));
  if (!title || !loc) return false;
  if (/\bpraha\b/.test(title) && /\bpraha\b/.test(loc)) return true;
  if (/\bbrno\b/.test(title) && /\bbrno\b/.test(loc)) return true;
  return false;
}

function validateSaveUnderstanding(turn, rawText) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  if (intent.indexOf(".create") < 0) return { pass: true, issues, confidence: "high" };

  const title = draftField(turn, "title");
  const note = draftField(turn, "note");
  const body = draftField(turn, "body");
  const loc = draftField(turn, "location");
  const taskNote = String((turn.draft && turn.draft.taskNote) || "");

  if (title && validator.hasAssistantNameLeakage(title)) issues.push("title_contains_assistant_name");
  if (title && payloadCore.hasInstructionLeakage(title)) issues.push("title_contains_command_wrapper");
  if (hasTemporalInTitleWhenSlotsFilled(turn)) issues.push("title_contains_date_time");
  if (hasLocationInTitleWhenLocFilled(turn)) issues.push("title_contains_location");
  if (title && /\b(napis\s+tam|pripomen\s+mi|jeste\s+tam\s+dej|protoze\s+to\s+zase)\b/.test(foldCs(title)))
    issues.push("title_contains_note");

  if (loc && /\b(prosim\s+te|napi[sš]\s+tam|pripomen|nezapomenu)\b/.test(foldCs(loc)))
    issues.push("location_contains_note_or_filler");

  if (note && payloadCore.hasInstructionLeakage(note)) issues.push("event_note_contains_command_wrapper");
  if (taskNote && payloadCore.hasInstructionLeakage(taskNote)) issues.push("task_note_contains_command_wrapper");
  if (body && (validator.hasAssistantNameLeakage(body) || payloadCore.hasInstructionLeakage(body)))
    issues.push("note_body_contains_command_wrapper");

  const baseVal = validator.validateCleanPayload(turn, rawText);
  for (let i = 0; i < baseVal.violations.length; i++) {
    if (issues.indexOf(baseVal.violations[i]) < 0) issues.push(baseVal.violations[i]);
  }

  if (intent === "notes.create" && payloadCore.isEventNoteContext(rawText)) issues.push("event_note_leaked_to_notes_create");
  if (intent === "notes.create" && payloadCore.isTaskNoteContext(rawText)) issues.push("task_note_leaked_to_notes_create");

  const confMeta = turn.draft && turn.draft.meta ? turn.draft.meta.saveUnderstandingConfidence : "high";
  let confidence = confMeta || (issues.length ? "medium" : "high");
  if (issues.length > 2) confidence = "low";

  return { pass: issues.length === 0, issues, confidence };
}

function repairTitleFromSlots(intent, rawText, title0) {
  const slots = payloadCore.iuSilverExtractSemanticSlotsV1(intent, rawText, new Date());
  if (intent === "calendar.create") return String(slots["event.title"] || "").trim() || title0;
  if (intent === "tasks.create") return String(slots["task.title"] || "").trim() || title0;
  return title0;
}

function repairNoteFromRaw(intent, rawText, note0) {
  if (intent === "calendar.create") {
    const m = String(rawText || "").match(/\bnapi[sš](?:\s+mi)?\s+tam\s+(?:že\s+|ze\s+)?(.+)$/iu);
    if (m && m[1]) return cleanReminderNote(m[1]);
  }
  if (intent === "tasks.create") {
    const m =
      String(rawText || "").match(/\bnapi[sš](?:\s+mi)?\s+tam\s+(?:že\s+|ze\s+)?(.+)$/iu) ||
      String(rawText || "").match(/\bjest[eě]\s+tam\s+dej\s+(?:že\s+|ze\s+)?(.+)$/iu);
    if (m && m[1]) return cleanTaskNote(m[1]);
  }
  return note0;
}

module.exports = {
  CORE_ID,
  validateSaveUnderstanding,
  repairTitleFromSlots,
  repairNoteFromRaw,
  hasTemporalInTitleWhenSlotsFilled,
  hasLocationInTitleWhenLocFilled,
  draftField,
  foldCs,
  stripInstructionPrefixes,
  stripAssistantInvocation,
};
