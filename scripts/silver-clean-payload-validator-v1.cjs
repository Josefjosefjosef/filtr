/**
 * Silver Clean Payload Validator V1 — foundation layer (scripts-only).
 * Layer 4: module-safe validation guards.
 */
"use strict";

const VALIDATOR_ID = "silver_clean_payload_validator_v1";

const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const searchCore = require("./silver-search-understanding-v1-core.cjs");
const convCore = require("./silver-conversation-state-v1-core.cjs");

const {
  foldCs,
  hasInstructionLeakage,
  isEventNoteContext,
  isNotesModuleContext,
  isTaskNoteContext,
  stripInstructionPrefixes,
} = payloadCore;

function draftField(turn, name) {
  const d = turn && turn.draft ? turn.draft : {};
  if (name === "title") return String(d.title || d.eventTitle || "");
  if (name === "note") return String(d.silverNoteText || d.note || d.eventNote || "");
  if (name === "location") return String(d.location || d.eventLocation || "");
  if (name === "body") return String(d.noteBody || d.body || d.silverNoteText || "");
  return String(d[name] || "");
}

function validateEventNoteVsNotesModule(turn, rawText) {
  const violations = [];
  const intent = String(turn.normalizedIntent || "");
  if (isEventNoteContext(rawText) && intent === "notes.create") {
    violations.push("event_note_leaked_to_notes_create");
  }
  if (isNotesModuleContext(rawText) && intent === "calendar.create" && !/\b(schuzk|schůzk|kalend)\b/i.test(foldCs(rawText))) {
    violations.push("notes_module_routed_to_calendar");
  }
  return violations;
}

function validateTaskNoteVsNoteBody(turn, rawText) {
  const violations = [];
  const intent = String(turn.normalizedIntent || "");
  if (isTaskNoteContext(rawText) && intent === "notes.create") {
    violations.push("task_note_leaked_to_notes_create");
  }
  if (intent === "tasks.create" && isNotesModuleContext(rawText) && !isTaskNoteContext(rawText)) {
    violations.push("notes_module_routed_to_tasks");
  }
  const noteField = draftField(turn, "note");
  const bodyField = draftField(turn, "body");
  if (intent === "tasks.create" && bodyField && !noteField && isTaskNoteContext(rawText)) {
    violations.push("task_note_in_note_body_slot");
  }
  if (intent === "notes.create" && noteField && !bodyField && isTaskNoteContext(rawText)) {
    violations.push("task_note_context_in_notes_module");
  }
  return violations;
}

function validateInstructionLeakageInTitle(turn) {
  const violations = [];
  const intent = String(turn.normalizedIntent || "");
  if (intent.indexOf(".create") < 0 && intent.indexOf(".update") < 0) return violations;
  const title = draftField(turn, "title");
  if (title && hasInstructionLeakage(title)) {
    violations.push("instruction_prefix_in_title");
  }
  const note = draftField(turn, "note");
  if (note && hasInstructionLeakage(note)) {
    violations.push("instruction_prefix_in_note");
  }
  return violations;
}

function validateLocationInTitle(turn) {
  const violations = [];
  const title = draftField(turn, "title");
  const location = draftField(turn, "location");
  const foldTitle = foldCs(title);
  if (/\b(praha|brno|ostrava|ulice|nam\.|nám\.)\b/.test(foldTitle) && !location) {
    violations.push("address_remains_in_title");
  }
  return violations;
}

function validateRawCommandInPayload(turn, rawText) {
  const violations = [];
  const intent = String(turn.normalizedIntent || "");
  if (intent.indexOf(".create") < 0) return violations;
  const title = draftField(turn, "title");
  const foldRaw = foldCs(rawText);
  const foldTitle = foldCs(title);
  if (title && foldTitle.length > 20 && foldRaw.indexOf(foldTitle.slice(0, Math.min(30, foldTitle.length))) === 0) {
    violations.push("raw_command_stored_as_title");
  }
  return violations;
}

function validateCleanPayload(turn, rawText, options) {
  const opts = options || {};
  const violations = [];
  violations.push.apply(violations, validateEventNoteVsNotesModule(turn, rawText));
  violations.push.apply(violations, validateTaskNoteVsNoteBody(turn, rawText));
  violations.push.apply(violations, validateInstructionLeakageInTitle(turn));
  violations.push.apply(violations, validateLocationInTitle(turn));
  violations.push.apply(violations, validateRawCommandInPayload(turn, rawText));

  if (opts.searchSemantics) {
    violations.push.apply(violations, searchCore.validateSearchModeAlignment(turn, opts.searchSemantics));
  }
  if (opts.conversationState) {
    violations.push.apply(violations, convCore.validateContinuationAlignment(rawText, opts.conversationState, turn));
  }
  return { pass: violations.length === 0, violations };
}

function suggestCleanTitle(rawText) {
  const cal = payloadCore.extractCalendarSlots(rawText, new Date());
  if (cal["event.title"]) return cal["event.title"];
  const task = payloadCore.extractTaskSlots(rawText, new Date());
  if (task["task.title"]) return task["task.title"];
  return stripInstructionPrefixes(rawText);
}

function buildClarificationPreview(turn, rawText) {
  const cal = payloadCore.extractCalendarSlots(rawText, new Date());
  const parts = [];
  if (cal["event.title"]) parts.push("schůzku " + cal["event.title"].replace(/^Schůzka\s+/i, "s "));
  if (cal["event.date"]) parts.push(cal["event.date"] === "today" ? "dnes" : cal["event.date"] === "tomorrow" ? "zítra" : cal["event.date"]);
  if (cal["event.time"]) parts.push("v " + cal["event.time"]);
  if (cal["event.location"]) parts.push("v " + cal["event.location"]);
  if (cal["event.note"]) parts.push("poznámka " + cal["event.note"]);
  if (parts.length) return "Mám uložit " + parts.join(", ") + "?";
  const title = draftField(turn, "title");
  if (title) return "Mám uložit " + title + "?";
  return "";
}

module.exports = {
  VALIDATOR_ID,
  validateCleanPayload,
  validateEventNoteVsNotesModule,
  validateTaskNoteVsNoteBody,
  validateInstructionLeakageInTitle,
  validateLocationInTitle,
  validateRawCommandInPayload,
  suggestCleanTitle,
  buildClarificationPreview,
  draftField,
};
