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
  if (name === "note") return String(d.silverNoteText || d.note || d.eventNote || d.taskNote || "");
  if (name === "location") return String(d.location || d.eventLocation || "");
  if (name === "body") return String(d.noteBody || d.body || d.silverNoteText || "");
  return String(d[name] || "");
}

function hasAssistantNameLeakage(fieldValue) {
  const fold = foldCs(fieldValue);
  if (!fold) return false;
  if (/\bsilver[eau]?\b/.test(fold)) return true;
  if (/\b(?:hej|ahoj)\s+silver\b/.test(fold)) return true;
  return false;
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

function hasInstructionLeakageInNoteField(noteValue) {
  let s = String(noteValue || "").trim();
  if (!s) return false;
  for (let ti = 0; ti < 8; ti++) {
    const prevT = s;
    s = s.replace(/\s*\([^)]{0,48}\)\s*$/u, "").trim();
    s = s
      .replace(
        /\s+(?:jo|no|d[ií]ky(?:\s+moc)?|honem|no\s+stress|stress|prosim(?:\w*)?(?:\s+t[eě])?|rychle)\s*$/giu,
        ""
      )
      .trim();
    s = s
      .replace(
        /\s+(?:z[ií]tra|zejtra|dnes(?:ka)?|v\s+p[aá]tek|r[aá]no|odpoledne|ve\s+stredu|pond[eě]l[ií]?|utery|ctvrtek)(?:\s+\S+)*\s*$/iu,
        ""
      )
      .trim();
    if (s === prevT) break;
  }
  for (let i = 0; i < 8; i++) {
    const prev = s;
    s = s.replace(/^(?:jako|trochu|nejak|nějak|no|fakt|prost[eě]|hele|jo)\s+/iu, "").trim();
    if (s === prev) break;
  }
  const lead = s.slice(0, 80);
  return hasInstructionLeakage(lead);
}

function validateInstructionLeakageInTitle(turn) {
  const violations = [];
  const intent = String(turn.normalizedIntent || "");
  if (intent.indexOf(".create") < 0 && intent.indexOf(".update") < 0) return violations;
  const title = draftField(turn, "title");
  if (title && hasInstructionLeakage(title)) {
    violations.push("instruction_prefix_in_title");
  }
  if (title && hasAssistantNameLeakage(title)) {
    violations.push("assistant_name_in_title");
  }
  const note = draftField(turn, "note");
  if (note && hasInstructionLeakageInNoteField(note)) {
    violations.push("instruction_prefix_in_note");
  }
  if (note && hasAssistantNameLeakage(note)) {
    violations.push("assistant_name_in_note");
  }
  const body = draftField(turn, "body");
  if (body && hasAssistantNameLeakage(body)) {
    violations.push("assistant_name_in_body");
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
  if (!title || foldTitle.length <= 20) return violations;
  let matchedLen = 0;
  if (foldRaw.indexOf(foldTitle) === 0) {
    matchedLen = foldTitle.length;
  } else {
    const prefix = foldTitle.slice(0, Math.min(30, foldTitle.length));
    if (foldRaw.indexOf(prefix) !== 0) return violations;
    matchedLen = prefix.length;
  }
  const remainder = foldRaw.slice(matchedLen).trim();
  if (!remainder) return violations;
  if (/^(?:a\s+(?:napi[sš]|napis)\s+tam\b|a\s+(?:připomeň|pripomen)\b)/i.test(remainder)) return violations;
  if (
    /^(z[ií]tra|zejtra|zitra|dnes(?:ka)?|pondeli|pond[eě]l[ií]|utery|stredu|ctvrtek|patek|p[aá]tek|rano|r[aá]no|odpoledne|dopoledne|v\s+p[aá]tek|dal[sš][ií]|ne[jk]ak|fakt|jako|prosim|d[ií]k(?:y(?:\s+moc)?)?|no\s+stress|honem|sp[eě]ch[aá]m|[\u2014\-–—.,!?()\s])+$/i.test(
      remainder
    )
  ) {
    return violations;
  }
  if (/^(z[ií]tra|zejtra|dnes|pondeli|rano|v\s+p[aá]tek|dal[sš][ií]|d[ií]k(?:y(?:\s+moc)?)?)\b/.test(remainder) && remainder.length < 48) {
    return violations;
  }
  violations.push("raw_command_stored_as_title");
  return violations;
}

function validateTitleTemporalWhenSlotsFilled(turn) {
  const violations = [];
  const intent = String(turn.normalizedIntent || "");
  if (intent !== "calendar.create" && intent !== "tasks.create") return violations;
  const d = turn.draft || {};
  const title = foldCs(draftField(turn, "title"));
  const hasDate = d.meta && d.meta.date === "certain";
  const hasTime = d.meta && d.meta.time === "certain";
  if (title && (hasDate || hasTime) && /\b(zitra|zejtra|dnes|kolem\s+\w|v\s+\d{1,2})\b/.test(title)) {
    violations.push("title_contains_date_time");
  }
  return violations;
}

function validateLocationFiller(turn) {
  const violations = [];
  const loc = foldCs(draftField(turn, "location"));
  if (loc && /\b(prosim\s+te|napi[sš]\s+tam|pripomen|nezapomenu|protoze\s+to\s+zase)\b/.test(loc)) {
    violations.push("location_contains_note_or_filler");
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
  violations.push.apply(violations, validateTitleTemporalWhenSlotsFilled(turn));
  violations.push.apply(violations, validateLocationFiller(turn));

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
  hasAssistantNameLeakage,
  validateCleanPayload,
  validateEventNoteVsNotesModule,
  validateTaskNoteVsNoteBody,
  validateInstructionLeakageInTitle,
  validateLocationInTitle,
  validateRawCommandInPayload,
  validateTitleTemporalWhenSlotsFilled,
  validateLocationFiller,
  suggestCleanTitle,
  buildClarificationPreview,
  draftField,
};
