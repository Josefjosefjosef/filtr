/**
 * Silver Semantic Payload Engine V1 — foundation core (scripts-only, no engine rewrite).
 * Layer 1: intent + module scope
 * Layer 2: semantic slot extraction helpers
 * Layer 3: clean payload engine (instruction stripping)
 * Layer 4: SEMANTIC SLOT EXTRACTION ENGINE V1 — unified slot API (mirrors assets/app.js)
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

function normalizeWs(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
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

function stripAssistantInvocation(text) {
  let s = normalizeWs(String(text || ""));
  if (!s) return s;
  const pats = [
    /^(?:hej|ahoj|čau|cau|zdar|nazdar)\s*,?\s*silver[eau]?\s*(?:,|\s+pros[ií]m(?:\s+t[eě])?)?\s+/iu,
    /^silver[eau]?\s*,?\s*pros[ií]m(?:\s+t[eě])?\s+/iu,
    /^silver[eau]?\s+/iu,
    /^(?:prosim\s+t[eě]|prosím\s+tě)\s+silver[eau]?\s+/iu,
  ];
  for (let rnd = 0; rnd < 12; rnd++) {
    const prev = s;
    for (let i = 0; i < pats.length; i++) {
      s = s.replace(pats[i], "").trim();
    }
    s = s.replace(/\bsilver[eau]?\s+(?=vlo[zž]|ulo[zž]|uloz|pridej|přidej|dej|zapi[sš]|hod|ho[dď]|pripomen|připomeň|napi[sš])/iu, "").trim();
    s = normalizeWs(s);
    if (s === prev) break;
  }
  return s;
}

function hasAssistantNameLeakage(fieldValue) {
  const fold = foldCs(fieldValue);
  if (!fold) return false;
  return /\bsilver[eau]?\b/.test(fold) || /\b(?:hej|ahoj)\s+silver\b/.test(fold);
}

function stripInstructionPrefixes(text) {
  let s = stripAssistantInvocation(String(text || "").trim());
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

function extractCalendarEventHead(rawText) {
  let work = stripInstructionPrefixes(stripAssistantInvocation(String(rawText || "").trim()));
  if (!work) return "";
  if (/\bdoktor\w*\b/i.test(work) && !/\bschuzk/i.test(foldCs(work))) return "Doktor";
  if (/\bzubar\w*\b/i.test(work)) return "Zubař";
  if (/\bservis\s+auta\b/i.test(work)) return "Servis auta";
  const techM = work.match(/\btechnik(?:\s+kvuli\s+[^,.]+?)?\b/i);
  if (techM && techM[0]) {
    const tw = String(techM[0]).trim();
    return tw.charAt(0).toLocaleUpperCase("cs-CZ") + tw.slice(1);
  }
  return "";
}

function hasInstructionLeakage(fieldValue) {
  const fold = foldCs(fieldValue);
  if (!fold) return false;
  for (let i = 0; i < INSTRUCTION_PREFIXES.length; i++) {
    if (INSTRUCTION_PREFIXES[i].test(fold)) return true;
  }
  return false;
}

function normalizeLocationLabel(locRaw) {
  let s = normalizeWs(locRaw).replace(/^v\s+/i, "").trim();
  if (!s) return "";
  const fold = foldCs(s);
  if (/\bpraz[eě]\s+jedna\b/.test(fold) || /\bpraha\s+jedna\b/.test(fold)) return "Praha 1";
  if (/^praz[eě]$/i.test(fold) || /^praha$/i.test(fold)) return "Praha";
  if (/^restauraci\s+/i.test(s)) s = s.replace(/^restauraci\s+/i, "Restaurace ");
  if (s && /^[a-záčďěéíňóřšťúůýž]/.test(s)) {
    s = s.charAt(0).toLocaleUpperCase("cs-CZ") + s.slice(1);
  }
  return s.slice(0, 200);
}

function cleanReminderNote(tailRaw) {
  let s = stripInstructionPrefixes(String(tailRaw || ""));
  s = s.replace(/^(?:a[tť]|ze|že|si|a)\s+/iu, "").trim();
  s = s.replace(/^mu\s+/iu, "").trim();
  s = s.replace(/^(?:že|ze)\s+m[aá]m\s+vz[ií]t\b/iu, "Vzít").trim();
  s = s.replace(/^m[aá]m\s+vz[ií]t\b/iu, "Vzít").trim();
  s = s.replace(/^mu\s+m[aá]m\s+vz[ií]t\b/iu, "Vzít").trim();
  s = s.replace(/^(?:že|ze)\s+nesm[ií]m\s+zapomenout\b/iu, "Nesmím zapomenout").trim();
  if (/^(?:vezmu|vezu)\s+/iu.test(s)) {
    s = "Vzít " + s.replace(/^(?:vezmu|vezu)\s+/iu, "").trim();
  } else if (s && !/^vz[ií]t\b/i.test(s) && /\b(vz[ií]t|vezmu|vezu)\b/i.test(s)) {
    s = "Vzít " + s;
  }
  if (s && /^[a-záčďěéíňóřšťúůýž]/.test(s)) {
    s = s.charAt(0).toLocaleUpperCase("cs-CZ") + s.slice(1);
  }
  return normalizeWs(s).slice(0, 1000);
}

function cleanTaskNote(tailRaw) {
  let s = String(tailRaw || "").trim();
  s = s.replace(/^(?:a\s+)?napi[sš]\s+tam\s+(?:že\s+|ze\s+)?/iu, "").trim();
  s = s.replace(/^(?:dej\s+tam\s+(?:pozn[aá]mk\w*\s+)?(?:že\s+|ze\s+)?)/iu, "").trim();
  s = s.replace(/^(?:a[tť]\s+nezapomenu\s+)/iu, "").trim();
  s = s.replace(/^(?:že\s+|ze\s+)/iu, "").trim();
  s = stripInstructionPrefixes(s);
  if (s && /^[a-záčďěéíňóřšťúůýž]/.test(s)) {
    s = s.charAt(0).toLocaleUpperCase("cs-CZ") + s.slice(1);
  }
  return normalizeWs(s).slice(0, 1000);
}

function extractPersonFromTitle(text) {
  const m = String(text || "").match(/\b(?:s|se)\s+([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+(?:ov[ouá]|em|em|ou)?)\b/);
  return m ? m[1] : "";
}

function extractCalendarSlots(rawText, now) {
  const raw = String(rawText || "").trim();
  const slots = {};
  for (let i = 0; i < CALENDAR_SLOTS.length; i++) slots[CALENDAR_SLOTS[i]] = "";
  if (!raw) {
    void now;
    return slots;
  }

  const locMeet = raw.match(
    /\b(?:m[aá]me\s+se\s+potkat|potkat\s+se|sejdeme)\s+v\s+([^,.]+?)(?:\s+a\s+(?:připomeň|pripomen)|$)/iu
  );
  if (locMeet && locMeet[1]) {
    slots["event.location"] = normalizeLocationLabel(locMeet[1]);
  }
  if (!slots["event.location"]) {
    const locPraha = raw.match(/\bpraha\s+(\d{1,2})\b/i);
    if (locPraha && locPraha[1]) slots["event.location"] = "Praha " + locPraha[1];
  }
  if (!slots["event.location"]) {
    const meetPotkat = raw.match(
      /\b(?:m[aá]me\s+se\s+potkat|potkat\s+se|sejdeme)\s+(?:v\s+)?([^,.]+?)(?:\s+a\s+(?:napi[sš]|připomeň|pripomen)|\s+jo\s*$|$)/i
    );
    if (meetPotkat && meetPotkat[1]) {
      slots["event.location"] = normalizeLocationLabel(meetPotkat[1]);
    }
  }

  const noteM = raw.match(/\b(?:a\s+)?(?:připomeň|pripomen)\s+mi\s+(?:a[tť]\s+)?(.+)$/i);
  if (noteM && noteM[1]) {
    slots["event.note"] = cleanReminderNote(noteM[1]);
  }
  if (!slots["event.note"]) {
    const noteTam = raw.match(/\b(?:a\s+)?napi[sš]\s+tam\s+(?:že\s+|ze\s+)?(.+)$/iu);
    if (noteTam && noteTam[1]) {
      slots["event.note"] = cleanReminderNote(noteTam[1]);
    }
  }

  let titleCand = "";
  const schPan = raw.match(
    /\b(?:sch[uů]zk[au]|schuzk[au])\s+(?:kterou\s+m[aá]m\s+j[ií]t\s+)?(?:dnes(?:ka)?\s+)?(?:z[ií]tra\s+)?(?:(?:s|se)\s+)?panem\s+([A-Za-zÁÉÍÓÚÝČĎĚŇŘŠŤŮÝŽáéíóúůýčďěňřšťůýž]{2,48})\b/iu
  );
  if (schPan && schPan[1]) {
    const nm = String(schPan[1]).replace(/[.,;:]+$/g, "").trim();
    if (nm.length >= 2) {
      titleCand = "Schůzka s panem " + nm.charAt(0).toLocaleUpperCase("cs-CZ") + nm.slice(1);
    }
  }
  if (!titleCand) {
    const obedM = raw.match(/\bob[eě]d\s+(?:s|se)\s+([A-Za-zÁÉÍÓÚÝČĎĚŇŘŠŤŮÝŽáéíóúůýčďěňřšťůýž]{2,48})\b/iu);
    if (obedM && obedM[1]) {
      const nm = String(obedM[1]).replace(/[.,;:]+$/g, "").trim();
      if (nm) titleCand = "Oběd s " + nm.charAt(0).toLocaleUpperCase("cs-CZ") + nm.slice(1);
    }
  }
  if (!titleCand && /\bdoktor\w*\b/i.test(raw) && !/\bschuzk/i.test(foldCs(raw))) {
    titleCand = "Doktor";
  }
  if (!titleCand && /\bzubar\w*\b/i.test(raw)) {
    titleCand = "Zubař";
  }
  if (!titleCand && /\bservis\s+auta\b/i.test(raw)) {
    titleCand = "Servis auta";
  }
  if (!titleCand) {
    const techHead = raw.match(/\btechnik(?:\s+kv[uů]li\s+[^,.]+?)?\b/i);
    if (techHead && techHead[0]) {
      const tw = String(techHead[0]).trim();
      titleCand = tw.charAt(0).toLocaleUpperCase("cs-CZ") + tw.slice(1);
    }
  }
  if (titleCand) {
    titleCand = stripInstructionPrefixes(titleCand);
    titleCand = titleCand.replace(/\s+m[aá]me\s+se\s+potkat\b.*$/i, "").trim();
    slots["event.title"] = titleCand.slice(0, 120);
  }

  if (/\bz[ií]tra\b/i.test(foldCs(raw))) slots["event.date"] = "tomorrow";
  if (/\bdnes(ka)?\b/i.test(foldCs(raw))) slots["event.date"] = "today";

  const timeM = raw.match(/\bv\s+(\d{1,2})(?::(\d{2}))?\s*(?:hod(?:in)?)?\b/i) || raw.match(/\b(\d{1,2}:\d{2})\b/);
  if (timeM) {
    slots["event.time"] = timeM[2] != null ? timeM[1] + ":" + timeM[2] : timeM[1] + ":00";
  }

  void now;
  return slots;
}

function extractTaskSlots(rawText, now) {
  const slots = {};
  for (let i = 0; i < TASK_SLOTS.length; i++) slots[TASK_SLOTS[i]] = "";

  const raw = String(rawText || "").trim();
  const noteTail = raw.match(/\b(?:a\s+)?napi[sš]\s+tam\s+(?:že\s+|ze\s+)?(.+)$/iu);
  if (noteTail && noteTail[1]) {
    slots["task.note"] = cleanTaskNote(noteTail[1]);
  }
  if (!slots["task.note"]) {
    const noteDej = raw.match(/\bdej\s+tam\s+pozn[aá]mk\w*\s+(?:že\s+|ze\s+)?(.+)$/iu);
    if (noteDej && noteDej[1]) slots["task.note"] = cleanTaskNote(noteDej[1]);
  }
  if (!slots["task.note"]) {
    const noteAt = raw.match(/\ba[tť]\s+nezapomenu\s+(.+)$/iu);
    if (noteAt && noteAt[1]) slots["task.note"] = cleanTaskNote(noteAt[1]);
  }

  let work = raw
    .replace(/\b(?:a\s+)?napi[sš]\s+tam\s+.+$/iu, "")
    .replace(/\bdej\s+tam\s+pozn[aá]mk\w*\s+.+$/iu, "")
    .replace(/\ba[tť]\s+nezapomenu\s+.+$/iu, "")
    .trim();
  work = work.replace(/^(?:připomeň|pripomen)\s+mi\s+(?:že\s+mám\s+|ze\s+mam\s+)?/iu, "").trim();
    work = work.replace(/\b(z[ií]tra|zejtra|zitra)\s+r[aá]no\b/iu, "").trim();
    work = work.replace(/\b(z[ií]tra|zejtra|zitra)\b/iu, "").trim();
  work = work.replace(/\b(?:že\s+mám|ze\s+mam)\s+/iu, "").trim();
  work = stripInstructionPrefixes(work);
  if (work) {
    slots["task.title"] = work.charAt(0).toLocaleUpperCase("cs-CZ") + work.slice(1);
  }
  void now;
  return slots;
}

function extractNoteSlots(rawText, now) {
  const slots = {};
  for (let i = 0; i < NOTE_SLOTS.length; i++) slots[NOTE_SLOTS[i]] = "";

  let body = String(rawText || "").trim();
  body = body.replace(/^ul[oó][zž](?:te)?\s+mi\s+do\s+pozn[aá]m(?:ek|ky|ce)\s+(?:že\s+|ze\s+)?/iu, "").trim();
  body = body.replace(/^uloz\s+mi\s+do\s+poznam\w*\s+(?:ze|že)\s+/iu, "").trim();
  body = stripInstructionPrefixes(body);
  if (body) slots["note.body"] = body;
  void now;
  return slots;
}

/** Unified SEMANTIC SLOT EXTRACTION ENGINE V1 entry (scripts mirror of engine API). */
function iuSilverExtractSemanticSlotsV1(intent, rawText, now) {
  const ni = String(intent || "");
  if (ni === "calendar.create") return extractCalendarSlots(rawText, now || new Date());
  if (ni === "tasks.create") return extractTaskSlots(rawText, now || new Date());
  if (ni === "notes.create") return extractNoteSlots(rawText, now || new Date());
  return {};
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
  stripAssistantInvocation,
  hasAssistantNameLeakage,
  extractCalendarSlots,
  extractTaskSlots,
  extractNoteSlots,
  iuSilverExtractSemanticSlotsV1,
  serializeCleanPayload,
  hasInstructionLeakage,
  isEventNoteContext,
  isNotesModuleContext,
  isTaskNoteContext,
  extractPersonFromTitle,
  normalizeLocationLabel,
  cleanReminderNote,
  cleanTaskNote,
  extractCalendarEventHead,
};
