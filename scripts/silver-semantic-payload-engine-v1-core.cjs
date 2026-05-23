/**
 * Silver Semantic Payload Engine V1 — foundation core (scripts-only, no engine rewrite).
 * Layer 1: intent + module scope
 * Layer 2: semantic slot extraction helpers
 * Layer 3: clean payload engine (instruction stripping)
 */
"use strict";

const CORE_ID = "silver_semantic_payload_engine_v1_core";

const MODULE_INTENTS = [
  "calendar.create",
  "calendar.read",
  "calendar.update",
  "tasks.create",
  "tasks.read",
  "tasks.update",
  "notes.create",
  "notes.read",
  "notes.update",
  "global.search",
  "clarification",
];

const CALENDAR_SLOTS = [
  "event.title",
  "event.date",
  "event.time",
  "event.end_time",
  "event.duration",
  "event.person",
  "event.location",
  "event.address",
  "event.note",
  "event.reminder",
  "event.recurrence",
];

const TASK_SLOTS = [
  "task.title",
  "task.deadline",
  "task.priority",
  "task.person",
  "task.location",
  "task.note",
  "task.status",
  "task.repeat",
];

const NOTE_SLOTS = ["note.title", "note.body", "note.topic", "note.person", "note.tags", "note.date_reference"];

/** Instruction prefixes that must not leak into stored payload fields. */
const INSTRUCTION_PREFIXES = [
  /\buloz\s+mi\b/i,
  /\buloz\s+to\b/i,
  /\bpridej\s+mi\b/i,
  /\bpridej\s+to\b/i,
  /\bhod\s+mi\b/i,
  /\bhod\s+to\b/i,
  /\bpripomen\s+mi\b/i,
  /\bpripomeň\s+mi\b/i,
  /\bmam\s+jit\b/i,
  /\bmám\s+jít\b/i,
  /\bmame\s+se\s+potkat\b/i,
  /\bmáme\s+se\s+potkat\b/i,
  /\bdo\s+kalendare\b/i,
  /\bdo\s+kalendáře\b/i,
  /\bdo\s+ukolu\b/i,
  /\bdo\s+úkolu\b/i,
  /\bdo\s+ukolu\b/i,
  /\bdo\s+poznamky\b/i,
  /\bdo\s+poznámky\b/i,
  /\bdneska\b/i,
  /\bdnes\b/i,
  /\bzitra\b/i,
  /\bzítra\b/i,
  /\bat\s+si\s+vezmu\b/i,
  /\bať\s+si\s+vezmu\b/i,
  /\bnapis\s+tam\b/i,
  /\bnapiš\s+tam\b/i,
  /\bprosim\s+te\b/i,
  /\bprosím\s+tě\b/i,
  /\bjen\s+mi\b/i,
  /\bpotrebuju\b/i,
  /\bpotřebuju\b/i,
  /\bzapis\s+mi\b/i,
  /\bzapiš\s+mi\b/i,
  /\bvytvor\s+mi\b/i,
  /\bvytvoř\s+mi\b/i,
  /\bdej\s+mi\b/i,
];

const EVENT_NOTE_CUES = [
  /\bdo\s+poznamky\b/i,
  /\bdo\s+poznámky\b/i,
  /\ba\s+do\s+poznamky\b/i,
  /\ba\s+do\s+poznámky\b/i,
  /\bpoznamenej\b/i,
  /\bpoznamenej\s+si\b/i,
  /\bpripomen\s+si\b/i,
  /\bpřipomeň\s+si\b/i,
  /\bhlavne\s+nezapomen\b/i,
  /\bhlavně\s+nezapomeň\b/i,
  /\ba\s+pripomen\b/i,
  /\ba\s+připomeň\b/i,
];

const NOTES_MODULE_CUES = [/\buloz\s+poznamku\b/i, /\bulož\s+poznámku\b/i, /\bnova\s+poznamka\b/i, /\bnová\s+poznámka\b/i];

const TASK_NOTE_CUES = [/\bdo\s+ukolu\b/i, /\bdo\s+úkolu\b/i, /\bk\s+ukolu\b/i, /\bk\s+úkolu\b/i, /\bukol\s+.*\bpoznam\b/i];

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function detectModuleScope(rawText) {
  const fold = foldCs(rawText);
  if (/\b(kolik|vypis|vypiš|ukaz|ukaž|najdi|seznam)\b/.test(fold)) {
    if (/\b(ukol|ukoly|úkol|úkoly|task)\b/.test(fold)) return "tasks.read";
    if (/\b(poznamk|poznámk|note)\b/.test(fold)) return "notes.read";
    if (/\b(schuzk|schůzk|kalend|udalost|událost)\b/.test(fold)) return "calendar.read";
    return "global.search";
  }
  if (NOTES_MODULE_CUES.some((re) => re.test(rawText))) return "notes.create";
  if (/\b(ukol|ukoly|úkol|úkoly)\b/.test(fold) && /\b(uloz|ulož|pridej|přidej|vytvor|vytvoř)\b/.test(fold)) return "tasks.create";
  if (/\b(schuzk|schůzk|kalend|udalost|událost)\b/.test(fold) && /\b(uloz|ulož|pridej|přidej|hod|dej|zapis|zapiš)\b/.test(fold))
    return "calendar.create";
  if (EVENT_NOTE_CUES.some((re) => re.test(rawText)) && /\b(schuzk|schůzk|kalend)\b/.test(fold)) return "calendar.create";
  return "clarification";
}

function stripInstructionPrefixes(text) {
  let s = String(text || "").trim();
  if (!s) return s;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < INSTRUCTION_PREFIXES.length; i++) {
      const re = INSTRUCTION_PREFIXES[i];
      const next = s.replace(re, "").replace(/^\s+/, "").trim();
      if (next !== s) {
        s = next;
        changed = true;
      }
    }
  }
  return s.replace(/\s+/g, " ").trim();
}

function extractPersonFromTitle(text) {
  const m = String(text || "").match(/\b(?:s|se)\s+([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+(?:ov[ouá]|em|em|ou)?)\b/);
  return m ? m[1] : "";
}

function extractCalendarSlots(rawText, now) {
  const fold = foldCs(rawText);
  const slots = {};
  for (let i = 0; i < CALENDAR_SLOTS.length; i++) slots[CALENDAR_SLOTS[i]] = "";

  const person = extractPersonFromTitle(rawText);
  if (person) {
    slots["event.person"] = person;
    slots["event.title"] = "Schůzka s " + person;
  }

  const schMatch = rawText.match(/\b(?:schůzk[au]|schuzk[au])\s+(?:s|se)\s+([^,.]+)/i);
  if (schMatch) {
    const head = schMatch[1].trim();
    slots["event.title"] = stripInstructionPrefixes("Schůzka s " + head);
  }

  if (/\bz[ií]tra\b/i.test(fold)) slots["event.date"] = "tomorrow";
  if (/\bdnes(ka)?\b/i.test(fold)) slots["event.date"] = "today";
  if (/\bpristi\s+tyden\b/i.test(fold) || /\bpříští\s+týden\b/i.test(fold)) slots["event.date"] = "next_week";

  const timeM = rawText.match(/\bv\s+(\d{1,2}(?::\d{2})?)\b.dev/i) || rawText.match(/\b(\d{1,2}:\d{2})\b/);
  if (timeM) slots["event.time"] = timeM[1];

  const locM = rawText.match(/\bv\s+(?:praze|praha|brne|brno|ostrave|ostrava)\b/i);
  if (locM) slots["event.location"] = locM[0].replace(/^v\s+/i, "").trim();

  for (let j = 0; j < EVENT_NOTE_CUES.length; j++) {
  const re = EVENT_NOTE_CUES[j];
    const idx = rawText.search(re);
    if (idx >= 0) {
      const tail = rawText.slice(idx).replace(re, "").trim();
      slots["event.note"] = stripInstructionPrefixes(tail.replace(/^(ze|že|si|a)\s+/i, ""));
      break;
    }
  }

  if (slots["event.title"]) slots["event.title"] = stripInstructionPrefixes(slots["event.title"]);
  void now;
  return slots;
}

function extractTaskSlots(rawText, now) {
  const slots = {};
  for (let i = 0; i < TASK_SLOTS.length; i++) slots[TASK_SLOTS[i]] = "";

  const taskM = rawText.match(/\b(?:ukol|úkol)\s*[:\-]?\s*(.+?)(?:\s+do\s+poznamk|\s+do\s+poznámk|$)/i);
  if (taskM) slots["task.title"] = stripInstructionPrefixes(taskM[1].trim());

  for (let j = 0; j < TASK_NOTE_CUES.length; j++) {
    const re = TASK_NOTE_CUES[j];
    const idx = rawText.search(re);
    if (idx >= 0) {
      const tail = rawText.slice(idx).replace(re, "").trim();
      slots["task.note"] = stripInstructionPrefixes(tail);
      break;
    }
  }
  void now;
  return slots;
}

function extractNoteSlots(rawText, now) {
  const slots = {};
  for (let i = 0; i < NOTE_SLOTS.length; i++) slots[NOTE_SLOTS[i]] = "";

  const bodyM = rawText.match(/\b(?:poznamk[au]|poznámku)\s*[:\-]?\s*(.+)$/i);
  if (bodyM) slots["note.body"] = stripInstructionPrefixes(bodyM[1].trim());
  void now;
  return slots;
}

function serializeCleanPayload(slots) {
  const parts = [];
  const keys = Object.keys(slots || {}).sort();
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = slots[k];
    if (v) parts.push(k + "=" + String(v));
  }
  return parts.join(";");
}

function hasInstructionLeakage(fieldValue) {
  const fold = foldCs(fieldValue);
  if (!fold) return false;
  for (let i = 0; i < INSTRUCTION_PREFIXES.length; i++) {
    if (INSTRUCTION_PREFIXES[i].test(fold)) return true;
  }
  return false;
}

function isEventNoteContext(rawText) {
  return EVENT_NOTE_CUES.some((re) => re.test(rawText)) && !NOTES_MODULE_CUES.some((re) => re.test(rawText));
}

function isNotesModuleContext(rawText) {
  return NOTES_MODULE_CUES.some((re) => re.test(rawText));
}

function isTaskNoteContext(rawText) {
  return TASK_NOTE_CUES.some((re) => re.test(rawText));
}

module.exports = {
  CORE_ID,
  MODULE_INTENTS,
  CALENDAR_SLOTS,
  TASK_SLOTS,
  NOTE_SLOTS,
  INSTRUCTION_PREFIXES,
  EVENT_NOTE_CUES,
  NOTES_MODULE_CUES,
  TASK_NOTE_CUES,
  foldCs,
  detectModuleScope,
  stripInstructionPrefixes,
  extractCalendarSlots,
  extractTaskSlots,
  extractNoteSlots,
  serializeCleanPayload,
  hasInstructionLeakage,
  isEventNoteContext,
  isNotesModuleContext,
  isTaskNoteContext,
  extractPersonFromTitle,
};
