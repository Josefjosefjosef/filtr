/**
 * Silver Real UX audit v1 — 30k chaotic Czech mobile prompts (READ engine from assets/app.js only).
 * harness_id: audit_silver_real_ux_v1_30k
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { execSync } = require("child_process");

const HARNESS_ID = "audit_silver_real_ux_v1_30k";
const FIXED_NOW_ISO = "2026-05-04T12:00:00";
const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-real-ux-v1-report.json");
const TOTAL = 30000;
const FIXED_NOW = new Date(FIXED_NOW_ISO);

function readSilverEngineFromApp() {
  const appPath = path.join(REPO, "assets", "app.js");
  const app = fs.readFileSync(appPath, "utf8");
  const m = app.match(/\/\* IU_SILVER_P0_ENGINE_START \*\/([\s\S]*?)\/\* IU_SILVER_P0_ENGINE_END \*\//);
  if (!m) throw new Error("IU_SILVER_P0_ENGINE markers missing");
  return m[1].trim();
}

function loadEngine() {
  const SILVER = readSilverEngineFromApp();
  const ctx = {
    window: {},
    document: {
      readyState: "complete",
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  };
  ctx.window.document = ctx.document;
  ctx.window.localStorage = ctx.localStorage;
  vm.createContext(ctx);
  vm.runInContext(
    SILVER.replace(/document\.readyState/g, '"complete"').replace(/document\.addEventListener\([^)]+\)/g, "void 0"),
    ctx
  );
  return ctx.window.iuSilverCalendarEngine;
}

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function iso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function addDaysIso(isoDateStr, n) {
  const d = new Date(isoDateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return iso(d);
}

const TODAY = iso(FIXED_NOW);
const ZITRA = addDaysIso(TODAY, 1);
const POZITRI = addDaysIso(TODAY, 2);
const CTVRTEK = addDaysIso(TODAY, 3);
const PATEK = addDaysIso(TODAY, 4);
const PRISTI_PONDELI = addDaysIso(TODAY, 7);
const STREDa = addDaysIso(TODAY, 2);

function buildSeed() {
  const events = [
    { id: "e_petr", date: ZITRA, time: "15:00", title: "Schůzka s Petrem", address: "", note: "probrat smlouvu" },
    { id: "e_tomas", date: TODAY, time: "10:15", title: "Schůzka s Tomášem", address: "", note: "rychlá kontrola dokumentů" },
    { id: "e_zubar", date: ZITRA, time: "15:00", title: "Zubař", address: "Korunní 33 Praha", note: "vzít kartičku pojištěnce" },
    { id: "e_pravnik", date: TODAY, time: "18:00", title: "Právník", address: "Praha 1", note: "vzít smlouvu" },
    { id: "e_pavel", date: STREDa, time: "16:00", title: "Schůzka s Pavlem", address: "", note: "domluvit termín" },
    { id: "e_mariana", date: TODAY, time: "18:00", title: "Schůzka s Marianou", address: "", note: "vzít červenou tašku" },
    { id: "e_advokat", date: CTVRTEK, time: "14:30", title: "Advokát", address: "Praha 1", note: "vzít plnou moc" },
    { id: "e_doktor", date: POZITRI, time: "09:00", title: "Doktor", address: "Vinohradská 3 Praha", note: "vzít zprávu" },
    { id: "e_ucetni", date: PRISTI_PONDELI, time: "11:00", title: "Účetní", address: "Dlouhá 12 Praha", note: "vzít faktury" },
    { id: "e_kuryr", date: TODAY, time: "12:30", title: "Kurýr", address: "Ostrava centrum", note: "převzít balík" }
  ];
  const tasks = [
    { id: "t1", title: "koupit uhlí", status: "todo", dueAt: PATEK, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t2", title: "koupit rohlíky", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t3", title: "koupit mléko", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t4", title: "posekat trávu", status: "todo", dueAt: addDaysIso(TODAY, 10), note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t5", title: "koupit toaleták", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t6", title: "zavolat Pavlovi", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t7", title: "koupit auto", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t8", title: "poslat smlouvu právníkovi", status: "todo", dueAt: ZITRA, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t9", title: "vyzvednout balík", status: "todo", dueAt: TODAY, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t10", title: "nabít telefon", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t_done1", title: "zaplacená elektřina", status: "done", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t_done2", title: "odeslaná faktura právníkovi", status: "done", dueAt: ZITRA, note: "", priority: "medium", createdAt: 1, updatedAt: 1 }
  ];
  const notes = [
    { id: "n1", title: "Auto", content: "auto mělo modrou barvu", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n2", title: "Boty", content: "boty mají velikost 33", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n3", title: "Zubař", content: "zubař má adresu Korunní 33 Praha", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n4", title: "Klíče", content: "klíče jsou v šuplíku", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n5", title: "Mariana", content: "Mariana má červenou tašku", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n6", title: "PIN", content: "pin ke kartě je doma", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n7", title: "Wi-Fi", content: "heslo k Wi-Fi je ABCD1234", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n8", title: "Smlouva Novák", content: "u smlouvy s Novákem zkontrolovat článek 4", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }
  ];
  return { events, tasks, notes };
}

const SEED = buildSeed();

function ctxQuery() {
  return {
    now: FIXED_NOW,
    getEventsSnapshot: () => SEED.events,
    getTasksSnapshot: () => SEED.tasks,
    getNotesSnapshot: () => SEED.notes
  };
}

function ctxEmpty() {
  return { now: FIXED_NOW, getEventsSnapshot: () => [], getTasksSnapshot: () => [], getNotesSnapshot: () => [] };
}

function ctxForCase(c) {
  const g = c.group;
  if (
    g === "calendar_query" ||
    g === "task_query" ||
    g === "note_query" ||
    g === "multi_intent" ||
    g === "safety_negation" ||
    g === "update_vs_create" ||
    g === "temporal_reasoning" ||
    (g === "reminder_intent" && c.meta && c.meta.needs_seed) ||
    (g === "dirty_mobile_czech" && c.meta && c.meta.is_query)
  ) {
    return ctxQuery();
  }
  return ctxEmpty();
}

function rawUserMessage(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "").trim();
}

function engineToAuditIntent(rawIntent, category) {
  const i = String(rawIntent || "");
  if (i === "calendar.read") return "calendar.query";
  if (i === "tasks.read") return "task.query";
  if (i === "tasks.create") return "task.create";
  if (i === "notes.read") return "note.query";
  if (i === "notes.create") return "note.create";
  if (i === "notes.empty_prompt") return "note.create";
  if (i === "calendar.create") return "calendar.create";
  if (i === "create.storage_disambiguation") {
    if (category && category.indexOf("calendar") === 0) return "calendar.create";
    if (category && category.indexOf("task") === 0) return "task.create";
    if (category && category.indexOf("note") === 0) return "note.create";
    return "unknown";
  }
  if (i === "global.search") {
    if (category && category.indexOf("note") === 0) return "note.query";
    if (category && category.indexOf("task") === 0) return "task.query";
    if (category && category.indexOf("calendar") === 0) return "calendar.query";
    if (category === "multi_intent") return "multi.partial";
  }
  if (i === "clarification" || i === "unknown") return "unknown";
  if (i === "silver.user_address_set") return "salutation.side";
  return i || "unknown";
}

function routingCategoryForEngine(c) {
  const g = c.group;
  if (g === "dirty_mobile_czech" && c.meta && c.meta.underlying) return c.meta.underlying;
  if (g === "temporal_reasoning") return "calendar_query";
  if (g === "reminder_intent") return c.meta && c.meta.reminder_target === "task" ? "task_write" : "calendar_write";
  return g;
}

function hasNegWrite(folded) {
  return (
    /\bneuklad\w*\b/.test(folded) ||
    /\bnic\s+neuklad\w*\b/.test(folded) ||
    /\bnevytvarej\b/.test(folded) ||
    /\bnevytvářej\b/.test(folded) ||
    /\bjen\s+cti\b/.test(folded) ||
    /\bjen\s+čti\b/.test(folded) ||
    /\bjen\s+se\s+podivej\b/.test(folded) ||
    /\bjen\s+se\s+podívej\b/.test(folded) ||
    /\bpokud\s+nic\s+nenajdes\b/.test(folded) ||
    /\bpokud\s+nic\s+nenajdeš\b/.test(folded)
  );
}

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function calendarWriteHarnessIntentOverride(folded) {
  const f = String(folded || "");
  if (!f) return null;
  const strongReadNeg =
    /\bnic\s+neukladej\b/.test(f) ||
    /\bnic\s+nevytvarej\b/.test(f) ||
    /\bjen\s+cti\b/.test(f) ||
    /\bjen\s+se\s+podivej\b/.test(f) ||
    /\bpouze\s+cti\b/.test(f) ||
    /\bnevytvarej\s+udalost\b/.test(f) ||
    (/\bnevytvarej\b/.test(f) &&
      !/\bnevytvarej\s+ukol\b/.test(f) &&
      !/\bnevytvarej\s+poznam/.test(f) &&
      /\b(do\s+kalend|kalend|schuz|udalost)\b/.test(f));
  if (!strongReadNeg) return null;
  const writeCal =
    /\bdo\s+kalend/.test(f) &&
    (/\buloz\w*\b/.test(f) || /\bzapis\w*\b/.test(f) || /\bpridej\w*\b/.test(f) || /\bdej\b/.test(f) || /\bnahod\w*\b/.test(f));
  if (!writeCal) return null;
  return "calendar.query";
}

/**
 * Hard global read-only / no-save negation (foldCs). Does NOT include module-only lines
 * like „ne do úkolů / ne do poznámek“ — those may still pair with calendar.create when a write cue exists.
 */
function calendarWriteHardNoWriteFolded(fx) {
  const f = String(fx || "");
  if (!f) return false;
  if (/\bnic\s+neuklad\w*\b/.test(f)) return true;
  if (/\bnic\s+nevytvare\w*\b/.test(f)) return true;
  if (/\bjen\s+cti\b/.test(f)) return true;
  if (/\bjen\s+se\s+podivej\b/.test(f)) return true;
  if (/\bpouze\s+cti\b/.test(f)) return true;
  if (/\bpokud\s+nic\s+nenajdes\b/.test(f) && /\bnic\s+nevytvare\w*\b/.test(f)) return true;
  return false;
}

/** Single source for Real UX calendar_write bucket expectations (harness-only). */
function calendarWriteHarnessExpectedIntent(folded) {
  const f = String(folded || "");
  const ov = calendarWriteHarnessIntentOverride(f);
  if (ov) return ov;
  if (calendarWriteHardNoWriteFolded(f)) return "unknown";
  return "calendar.create";
}

function auditSilverTaskWriteReadOnlyNegVsExplicitJedenUkolFolded(fx) {
  const x = String(fx || "");
  if (!/\bjako\s+jeden\s+ukol\b/.test(x)) return false;
  const readOnlyNeg =
    /\bjen\s+se\s+podivej\b/.test(x) ||
    /\bjen\s+cti\b/.test(x) ||
    /\bjen\s+zjist\w*\b/.test(x) ||
    /\bjen\s+over\w*\b/.test(x) ||
    /\bjen\s+vypis\w*\b/.test(x);
  return readOnlyNeg;
}

function auditSilverTaskWriteReadOnlyLeadBeforeExplicitDoUkolFolded(fx) {
  const x = String(fx || "");
  if (!x) return false;
  if (/\bne\s+do\s+ukol/.test(x)) return false;
  const doM = /\bdo\s+ukol\w*\b/i.exec(x);
  if (!doM || typeof doM.index !== "number") return false;
  const doIdx = doM.index;
  const readRes = [
    /\bjen\s+se\s+podivej\b/i.exec(x),
    /\bjen\s+cti\b/i.exec(x),
    /\bjen\s+zjist\w*\b/i.exec(x),
    /\bjen\s+over\w*\b/i.exec(x),
    /\bjen\s+vypis\w*\b/i.exec(x),
    /\bpouze\s+cti\b/i.exec(x)
  ];
  let readIdx = -1;
  for (let ri = 0; ri < readRes.length; ri++) {
    const m = readRes[ri];
    if (m && typeof m.index === "number" && m.index >= 0 && (readIdx < 0 || m.index < readIdx)) readIdx = m.index;
  }
  if (readIdx < 0) return false;
  return readIdx < doIdx;
}

function auditSilverTaskWriteNakupJedenUkolDeadlineFolded(fx) {
  const x = String(fx || "");
  if (!/\bnakup\s*:/.test(x)) return false;
  if (!/\bjako\s+jeden\s+ukol\w*\b/.test(x)) return false;
  return /\bdo\s+patk\w*\b/.test(x) || /\bdo\s+zitr\w*\b/.test(x) || /\bdo\s+deset\w*\b/.test(x) || /\bdo\s+\d+\s+dn\w*\b/.test(x);
}

function auditSilverTaskWriteNeDoUkolLeadWorkLineFolded(fx) {
  const x = String(fx || "").trim();
  if (!/^\s*ne\s+do\s+ukol\w*\b/i.test(x)) return false;
  if (!/\bpracovn\w*\s*:/.test(x)) return false;
  return /\bne\s+kalendar\w*\b/.test(x) || /\bne\s+kalend\w*\b/.test(x);
}

function auditSilverNicNeukladejBlocksNoteWriteExpectationFolded(fx) {
  const f = String(fx || "");
  if (!/\bnic\s+neukladej\b/.test(f)) return false;
  if (/\bnic\s+neukladej\s+do\s+kalendar/.test(f)) return false;
  if (/\bzaroven\b|\bzároveň\b/.test(f) && /\b(do\s+kalend|\buloz\s+do\s+kalend|\buloz\s+mi\s+do\s+kalend|\bnahod)/.test(f)) return false;
  if (/^\s*do\s+poznam\w*\s+.*\bnapis/.test(f) || /^\s*napis\w*\s+do\s+poznam/.test(f)) return false;
  return true;
}

function auditSilverNoteWriteReadOnlyVersusExplicitWriteFolded(fx) {
  const x = String(fx || "");
  if (!x) return false;
  if (!noteWritePositiveCueFolded(x)) return false;
  return (
    /\bjen\s+cti\b/.test(x) ||
    /\bpouze\s+cti\b/.test(x) ||
    /\bjen\s+zjist/.test(x) ||
    /\bjen\s+se\s+podivej\b/.test(x) ||
    /\bjen\s+vypis\b/.test(x) ||
    /\bjen\s+over\b/.test(x) ||
    hasExplicitNoNotes(x) ||
    auditSilverNicNeukladejBlocksNoteWriteExpectationFolded(x) ||
    (/\bnic\s+nevytvarej\b/.test(x) && !/\bnic\s+nevytvarej\s+do\s+kalendar/.test(x)) ||
    /\bpokud\s+nic\s+nenajdes\b/.test(x) ||
    /\bpokud\s+nis\s+vysledek\b/.test(x)
  );
}

function detectCollectionConfusion(category, engIntent, expectedIntent) {
  const e = String(engIntent || "");
  const exp = String(expectedIntent || "");
  if (category === "calendar_write" || category === "calendar_query") {
    if (e === "tasks.create" && category === "calendar_write") return "calendar_vs_task_confusion";
    if (e === "notes.create" && category === "calendar_write") return "wrong_collection";
    if (category === "calendar_query" && (e === "tasks.create" || (e === "notes.create" && exp !== "note.query"))) return "calendar_vs_task_confusion";
  }
  if (category === "task_write" || category === "task_query") {
    if (e === "calendar.create" && category === "task_write") return "calendar_vs_task_confusion";
    if (e === "notes.create" && category === "task_write") return "note_vs_task_confusion";
    if (category === "task_query" && (e === "calendar.read" || e === "calendar.create")) return "calendar_vs_task_confusion";
  }
  if (category === "note_write" || category === "note_query") {
    if (e === "calendar.create" && category === "note_write") return "wrong_collection";
    if (e === "tasks.create" && category === "note_write") return "note_vs_task_confusion";
    if (category === "note_query" && (e === "calendar.read" || e === "calendar.create" || e === "tasks.read" || e === "tasks.create")) {
      return "note_vs_task_confusion";
    }
  }
  return null;
}

function hasExplicitNoCalendar(f) {
  const x = String(f || "");
  return /\bne\s+v\s+kalend|\bne\s+do\s+kalend|\bneuklad\w*\s+do\s+kalend|\bnic\s+z\s+toho\s+nedavej\s+do\s+kalend/.test(x);
}
function hasExplicitNoTasks(f) {
  return /\bne\s+do\s+ukol|\bne\s+v\s+ukol|\bneuklad\w*\s+do\s+ukol/.test(f);
}
function hasExplicitNoNotes(f) {
  return /\bne\s+do\s+poznam|\bne\s+v\s+poznam|\bne\s+poznam|\bnic\s+z\s+toho\s+nedavej\s+do\s+poznam/.test(f);
}

/** Explicitní zápis / obsah poznámky (ne šum z „ne do poznámek“). */
function noteWritePositiveCueFolded(fx) {
  const x = String(fx || "");
  if (!x) return false;
  return (
    /\buloz\w*\s+poznamku\b/.test(x) ||
    /\buloz\w*\s+mi\s+poznamku\b/.test(x) ||
    /\buloz\w*\s+me\s+poznamku\b/.test(x) ||
    /\buloz\w*\s+[\s\S]{0,48}?\bpoznamku\b/.test(x) ||
    /\bnapis\w*\s+si\s+do\s+poznam\w*\b/.test(x) ||
    /\bzapamatuj\s+si\b/.test(x) ||
    /\bpoznamenej\s+si\b/.test(x) ||
    /\buloz\s+si\b/.test(x) ||
    /\bpoznamka\s*:/.test(x) ||
    (/\bnapis\w*\s+si\b/.test(x) && /\bze\b/.test(x))
  );
}

/**
 * Prefix „ne do/v kalendáři“ + jasný zápis do poznámky → často abstain (unknown).
 * Nepoužívat pro příponu „…, ne do kalendáře“ (jen modul kalendáře, zápis poznámky platí).
 */
function noteWriteCalendarScopeNegationExpectNoWriteFolded(fx) {
  const x = String(fx || "").trim();
  if (!x) return false;
  if (!hasExplicitNoCalendar(x)) return false;
  if (hasExplicitNoNotes(x)) return false;
  if (!noteWritePositiveCueFolded(x)) return false;
  return /^(ne\s+do\s+kalend|ne\s+v\s+kalend|neuklad\w*\s+do\s+kalend|nic\s+z\s+toho\s+nedavej\s+do\s+kalend)/.test(x);
}

function calendarWriteSemantic(turn, raw, foldedIn) {
  if (turn.normalizedIntent === "calendar.read" && turn.processingState === "READ_OK") return { ok: true, cat: "" };
  if (!raw || raw.length < 6) return { ok: false, cat: "raw_response_empty" };
  if (turn.processingState === "STORAGE_DISAMBIGUATION") return { ok: false, cat: "unnecessary_disambiguation" };
  const f = foldCs(raw);
  if (hasExplicitNoCalendar(foldedIn) && /\bkalend|\budalost|\bschuzk/.test(f)) return { ok: false, cat: "negative_instruction_fail" };
  const ok =
    turn.processingState === "READY_TO_SAVE" ||
    turn.processingState === "NEEDS_CLARIFICATION" ||
    turn.processingState === "DRAFTING" ||
    /kalendář|kalendar|událost|udalost|schůzk|schuzk|ulož|uloz|přid|prid/i.test(raw);
  if (!ok) return { ok: false, cat: "raw_response_wrong" };
  return { ok: true, cat: "" };
}

function taskWriteSemantic(turn, raw, foldedIn) {
  if (!raw || raw.length < 5) return { ok: false, cat: "raw_response_empty" };
  if (turn.processingState === "STORAGE_DISAMBIGUATION") return { ok: false, cat: "unnecessary_disambiguation" };
  if (hasExplicitNoCalendar(foldedIn) && turn.normalizedIntent === "calendar.create") return { ok: false, cat: "negative_instruction_fail" };
  if (hasExplicitNoNotes(foldedIn) && turn.normalizedIntent === "notes.create") return { ok: false, cat: "negative_instruction_fail" };
  const ok =
    /úkol|ukol|task|ulož|uloz|přid|prid|hotov|seznam|zápis|zapis|neprovedu|neproved|upřesn|upresn/i.test(raw) ||
    turn.processingState === "READY_TO_SAVE";
  if (!ok) return { ok: false, cat: "raw_response_wrong" };
  return { ok: true, cat: "" };
}

function noteWriteSemantic(turn, raw, foldedIn) {
  if (!raw || raw.length < 5) return { ok: false, cat: "raw_response_empty" };
  if (turn.processingState === "STORAGE_DISAMBIGUATION") return { ok: false, cat: "unnecessary_disambiguation" };
  if (hasExplicitNoCalendar(foldedIn) && turn.normalizedIntent === "calendar.create") return { ok: false, cat: "negative_instruction_fail" };
  if (hasExplicitNoTasks(foldedIn) && turn.normalizedIntent === "tasks.create") return { ok: false, cat: "negative_instruction_fail" };
  const ok = /poznám|poznam|ulož|uloz|zapamat|informac/i.test(raw) || turn.processingState === "READY_TO_SAVE";
  if (!ok) return { ok: false, cat: "raw_response_wrong" };
  return { ok: true, cat: "" };
}

function auditFoldedStripTailEntityExcludeClauses(folded) {
  let x = String(folded || "");
  x = x.replace(/\bnevracej\s+\w+/g, " ");
  x = x.replace(/\bneukazuj\s+\w+/g, " ");
  x = x.replace(/\bnezobrazuj\s+\w+/g, " ");
  x = x.replace(/\bbez\s+zubar\w*/g, " ");
  x = x.replace(/\bne\s+zubar\w*/g, " ");
  return x.replace(/\s+/g, " ").trim();
}

function negForbiddenPerson(f) {
  const m = f.match(/\bnevrac\w*\s+(\w+)/);
  return m ? m[1] : "";
}

function calendarQuerySemantic(input, folded, turn, raw, expectedIntent) {
  const expI = String(expectedIntent || "");
  if (expI === "unknown") return { ok: true, cat: "" };
  if (turn.processingState === "READY_TO_SAVE" || turn.normalizedIntent === "calendar.create") {
    return { ok: false, cat: "query_created_write" };
  }
  if (turn.processingState === "STORAGE_DISAMBIGUATION" && hasNegWrite(folded)) {
    return { ok: false, cat: "negative_instruction_fail" };
  }
  if (!raw || raw.length < 8) return { ok: false, cat: "raw_response_empty" };
  const forb = negForbiddenPerson(folded);
  if (forb && forb.length > 2) {
    const bad =
      (forb.indexOf("tomas") >= 0 && /\bpetr\b/.test(folded) && /\btomas/.test(foldCs(raw))) ||
      (forb.indexOf("petr") >= 0 && /\btomas/.test(folded) && /\bpetr\b/.test(foldCs(raw)));
    if (bad) return { ok: false, cat: "wrong_person_match" };
  }
  const foldedProbe = auditFoldedStripTailEntityExcludeClauses(folded);
  if (
    expI !== "note.query" &&
    /nic\s+jsem\s+k\s+tomu\s+nenasel/i.test(foldCs(raw)) &&
    /\bzubar|petr|pravnik|advokat|korunn|prahou\s+1\b/.test(foldedProbe)
  ) {
    const mixedNegCalOhledneProbe =
      /\bohledn/.test(folded) &&
      /\bco\s+m(am|ame)\b/.test(folded) &&
      /\bv\s+kalend/.test(folded) &&
      (/\bne\s+v\s+kalend\w*/.test(folded) ||
        /\bnevracej\b/.test(folded) ||
        /\bneptej\s+se\s+kam\s+uloz/i.test(folded) ||
        /\bjen\s+cti\b/.test(folded) ||
        /\bnevytvarej\s+ukol/i.test(folded) ||
        /\bpokud\s+nic\s+nenajdes/i.test(folded) ||
        /\bneplet\s+to\s+s\s+kalend/i.test(folded));
    if (mixedNegCalOhledneProbe) return { ok: true, cat: "" };
    return { ok: false, cat: "false_negative" };
  }
  return { ok: true, cat: "" };
}

function taskQuerySemantic(input, folded, turn, raw, expectedIntent) {
  const expI = String(expectedIntent || "");
  if (expI === "unknown") return { ok: true, cat: "" };
  if (turn.processingState === "READY_TO_SAVE" || turn.normalizedIntent === "tasks.create") {
    return { ok: false, cat: "query_created_write" };
  }
  if (turn.normalizedIntent === "calendar.read" || turn.normalizedIntent === "calendar.create") {
    return { ok: false, cat: "query_wrong_dataset" };
  }
  if (turn.normalizedIntent === "notes.read" || turn.normalizedIntent === "notes.create") {
    return { ok: false, cat: "query_wrong_dataset" };
  }
  if (!raw || raw.length < 8) return { ok: false, cat: "raw_response_empty" };
  if (/\brohlik/.test(folded) && /\bschuzk|\budalost|\bkalend/.test(foldCs(raw))) return { ok: false, cat: "query_wrong_dataset" };
  return { ok: true, cat: "" };
}

function noteQuerySemantic(input, folded, turn, raw, expectedIntent) {
  const expI = String(expectedIntent || "");
  if (expI === "unknown") return { ok: true, cat: "" };
  if (turn.processingState === "READY_TO_SAVE" || turn.normalizedIntent === "notes.create") {
    return { ok: false, cat: "query_created_write" };
  }
  if (turn.normalizedIntent === "calendar.read" || turn.normalizedIntent === "calendar.create") {
    return { ok: false, cat: "query_wrong_dataset" };
  }
  if (turn.normalizedIntent === "tasks.read" || turn.normalizedIntent === "tasks.create") {
    return { ok: false, cat: "query_wrong_dataset" };
  }
  if (!raw || raw.length < 6) return { ok: false, cat: "raw_response_empty" };
  return { ok: true, cat: "" };
}

function multiSemantic(meta, turn, raw, folded) {
  const eng = turn.normalizedIntent;
  const ps = turn.processingState;
  if (meta.queryNeg) {
    const qf = foldCs(meta.queryNeg);
    if (
      (ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create") &&
      /jen\s+se\s+podivej|jen\s+cti|jen\s+čti|nic\s+neuklad|neuklad|nevytvarej|nevytvářej/.test(qf)
    ) {
      return { ok: false, cat: "query_created_write" };
    }
  }
  if (meta.needsDualWrite) {
    if (eng === "clarification" && String(raw || "").length > 8) return { ok: true, cat: "" };
    if (ps === "READY_TO_SAVE") return { ok: true, cat: "" };
    if (eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create" || eng === "global.search") {
      return { ok: true, cat: "" };
    }
    return { ok: false, cat: "multi_intent_fail" };
  }
  if (!raw || raw.length < 4) return { ok: false, cat: "raw_response_empty" };
  return { ok: true, cat: "" };
}

const TITLE_POLLUTION_RE = /\bhod\s+mi\b|\bdej\s+(mi\s+)?do\s+kalend|\buloz\s+mi\b|\bpripomen\s+mi\b|\bze\s+mam\b|\bze\s+[^s]/i;

function titleCleanForDraft(turn, foldedInput) {
  const d = turn.draft || {};
  const t = String(d.title || "").trim();
  if (!t) return { ok: true, skip: true };
  const ft = foldCs(t);
  if (TITLE_POLLUTION_RE.test(ft)) return { ok: false };
  if (ft.length > 100) return { ok: false };
  return { ok: true, skip: false };
}

function addressQuality(turn, foldedInput) {
  const d = turn.draft || {};
  const addr = foldCs(String(d.address || d.location || ""));
  const titleF = foldCs(d.title || "");
  const locHints = ["korunn", "praha", "ostrava", "brno", "vinohrad", "dlouh", "namest", "miru", "andela", "servis", "hlavni"];
  let hintInInput = false;
  for (let i = 0; i < locHints.length; i++) {
    if (foldedInput.indexOf(locHints[i]) >= 0) {
      hintInInput = true;
      break;
    }
  }
  if (!hintInInput) return { ok: true, skip: true };
  if (addr.length >= 6) return { ok: true, skip: false };
  let overlap = 0;
  for (let i = 0; i < locHints.length; i++) {
    const h = locHints[i];
    if (foldedInput.indexOf(h) >= 0 && titleF.indexOf(h) >= 0 && addr.indexOf(h) < 0) overlap++;
  }
  if (overlap >= 1 && addr.length < 4) return { ok: false };
  return { ok: true, skip: false };
}

function embeddedNoteQuality(turn, needleFolded) {
  const n = foldCs(String((turn.draft || {}).note || (turn.draft || {}).silverNoteText || ""));
  if (turn.normalizedIntent !== "calendar.create") return { ok: false, cat: "embedded_not_calendar" };
  if (needleFolded && n.indexOf(needleFolded) < 0) return { ok: false, cat: "embedded_note_missing" };
  return { ok: true, cat: "" };
}

function standaloneNoteCreateViolation(turn) {
  return (
    turn.normalizedIntent === "notes.create" &&
    turn.processingState === "READY_TO_SAVE" &&
    !turn.silverCompanionNoteTurn
  );
}

function temporalScopeCheck(meta, raw) {
  if (!meta || !meta.time_scope) return { ok: true };
  const fr = foldCs(raw || "");
  const fi = meta.folded_probe || "";
  if (meta.time_scope === "future") {
    if (/\bkdy\s+mam\b/.test(fi) && /\bvčera\b/.test(fr) && !/\bzitra|zítra|pristi|příští|dnes|naplánovan|další/.test(fr)) return { ok: false, cat: "future_query_returns_past" };
  }
  if (meta.time_scope === "past") {
    if (
      /\bkdy\s+jsem\s+mel\b/.test(fi) &&
      /\b(zitra|zítra|příští|pristi)\b/.test(fr) &&
      !/\b(minul|vcera|včera|byl|byla|skončil|skoncil)/.test(fr)
    ) {
      return { ok: false, cat: "past_query_ignored" };
    }
  }
  return { ok: true, cat: "" };
}

function gitTrackedClean() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const tracked = lines.filter((l) => !l.startsWith("??"));
    const allow = [
      "scripts/audit_silver_real_ux_v1.cjs",
      "scripts/silver-real-ux-v1-report.json",
      "scripts/audit_silver_20000_routing_stable.cjs",
      "scripts/audit_silver_realistic_mobile_corpus.cjs",
      "scripts/silver-quality-v2-report.json",
      "scripts/silver-realistic-mobile-corpus-report.json",
      "assets/app.js"
    ];
    const bad = tracked.filter((l) => {
      const t = l.replace(/^\s+/, "").trim();
      for (let ai = 0; ai < allow.length; ai++) {
        if (t.indexOf(allow[ai]) >= 0) return false;
      }
      return true;
    });
    return { ok: bad.length === 0, porcelain: o.trim() };
  } catch (e) {
    return { ok: false, porcelain: String(e) };
  }
}

function stripDiak(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function mixDiak(s) {
  return String(s || "")
    .replace(/á/g, "a")
    .replace(/ě/g, "e")
    .replace(/š/g, "s")
    .replace(/č/g, "c")
    .replace(/ř/g, "r")
    .replace(/ž/g, "z")
    .replace(/ý/g, "y")
    .replace(/í/g, "i");
}

function diacVariant(i, text) {
  const r = i % 23;
  if (r < 11) return text;
  if (r < 18) return stripDiak(text);
  return mixDiak(text);
}

const PERSONS = [
  "Novákem",
  "Petrem",
  "Tomášem",
  "Jakubem",
  "právníkem",
  "panem Novákem",
  "zubařem",
  "doktorem",
  "účetní",
  "Mariana",
  "Pavlem"
];
const ADDRS = [
  "Náměstí Míru Praha",
  "Korunní 44 Praha",
  "u Anděla",
  "Ostrava Hlavní 12",
  "Vinohradská 3 Praha",
  "Praha 1",
  "Spálená 3 Praha",
  "Brno centrum"
];
const NEGS = [
  "nic neukládej",
  "jen čti",
  "jen se podívej",
  "nic nevytvářej",
  "ne do kalendáře",
  "ne do úkolů",
  "ne do poznámek",
  "pokud nic nenajdeš nic nevytvářej"
];

function semanticGroupForEval(c) {
  if (c.group === "temporal_reasoning") return "calendar_query";
  if (c.group === "dirty_mobile_czech" && c.meta && c.meta.underlying) return c.meta.underlying;
  if (c.group === "safety_negation") return c.meta && c.meta.semantic_as ? c.meta.semantic_as : "calendar_query";
  if (c.group === "update_vs_create") return "update_vs_create";
  if (c.group === "reminder_intent") return "reminder_intent";
  return c.group;
}

function evaluateCore(c, turn) {
  const raw = rawUserMessage(turn);
  const folded = foldCs(c.input);
  const eng = turn.normalizedIntent;
  const rc = routingCategoryForEngine(c);
  const semG = semanticGroupForEval(c);
  let expectedIntent = c.expectedIntent;
  if (semG === "calendar_write" || c.group === "calendar_write" || (c.group === "dirty_mobile_czech" && c.meta && c.meta.underlying === "calendar_write")) {
    expectedIntent = calendarWriteHarnessExpectedIntent(folded);
  }
  let auditIntent = engineToAuditIntent(eng, rc);
  const conf = detectCollectionConfusion(semG === "reminder_intent" ? (c.meta.reminder_target === "task" ? "task_write" : "calendar_write") : semG, eng, expectedIntent);
  if (conf) return { pass: false, cat: conf, auditIntent, raw };

  if (c.group === "safety_negation") {
    if (createLikeTurn(turn)) return { pass: false, cat: "write_when_negated", auditIntent, raw };
    if (eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create") {
      return { pass: false, cat: "write_when_negated", auditIntent, raw };
    }
    const exp = c.expectedIntent;
    if (exp === "flexible_read") {
      const okRead = auditIntent === "calendar.query" || auditIntent === "task.query" || auditIntent === "note.query";
      if (!okRead && auditIntent !== "unknown") return { pass: false, cat: "wrong_module_readonly_negation", auditIntent, raw };
    } else if (auditIntent !== exp && auditIntent !== "unknown") {
      if (!(exp === "calendar.query" && auditIntent === "task.query") && !(exp === "task.query" && auditIntent === "calendar.query")) {
        if (exp !== "unknown") return { pass: false, cat: "intent_fail", auditIntent, raw };
      }
    }
    const sq = c.meta && c.meta.semantic_as;
    if (sq === "calendar_query") {
      const sem = calendarQuerySemantic(c.input, folded, turn, raw, "calendar.query");
      if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
    } else if (sq === "task_query") {
      const sem = taskQuerySemantic(c.input, folded, turn, raw, "task.query");
      if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
    } else if (sq === "note_query") {
      const sem = noteQuerySemantic(c.input, folded, turn, raw, "note.query");
      if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
    }
    return { pass: true, cat: "", auditIntent, raw };
  }

  if (c.group === "update_vs_create") {
    if (turn.normalizedIntent === "calendar.create" && turn.processingState === "READY_TO_SAVE") {
      return { pass: false, cat: "update_risk_new_create", auditIntent, raw };
    }
    if (auditIntent === "calendar.create" && turn.processingState === "READY_TO_SAVE") {
      return { pass: false, cat: "update_risk_new_create", auditIntent, raw };
    }
    return { pass: true, cat: "", auditIntent: "non_create_ok", raw };
  }

  if (c.group === "reminder_intent") {
    const kind = c.meta && c.meta.reminder_kind;
    if (kind === "missing_time") {
      const ok =
        eng === "clarification" ||
        auditIntent === "unknown" ||
        turn.processingState === "NEEDS_CLARIFICATION" ||
        turn.processingState === "CLARIFICATION" ||
        (eng === "calendar.create" && turn.processingState !== "READY_TO_SAVE");
      if (!ok && turn.processingState === "READY_TO_SAVE") return { pass: false, cat: "reminder_missing_time_not_clarified", auditIntent, raw };
      return { pass: true, cat: "", auditIntent, raw };
    }
    if (c.meta.reminder_target === "task") {
      if (auditIntent !== "task.create" && auditIntent !== "unknown") {
        return { pass: false, cat: "reminder_intent_fail", auditIntent, raw };
      }
      if (auditIntent === "task.create") {
        const sem = taskWriteSemantic(turn, raw, folded);
        if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
      }
      return { pass: true, cat: "", auditIntent, raw };
    }
    if (auditIntent !== "calendar.create" && auditIntent !== "unknown") {
      return { pass: false, cat: "reminder_intent_fail", auditIntent, raw };
    }
    if (auditIntent === "calendar.create") {
      const sem = calendarWriteSemantic(turn, raw, folded);
      if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
    }
    return { pass: true, cat: "", auditIntent, raw };
  }

  if (c.group === "multi_intent") {
    if (auditIntent === "salutation.side") return { pass: false, cat: "intent_fail", auditIntent, raw };
    const semM = multiSemantic(c.meta || {}, turn, raw, folded);
    if (!semM.ok) return { pass: false, cat: semM.cat, auditIntent, raw };
    return { pass: true, cat: "", auditIntent, raw };
  }

  if (
    c.group === "task_write" &&
    expectedIntent === "unknown" &&
    auditSilverTaskWriteReadOnlyNegVsExplicitJedenUkolFolded(folded) &&
    (eng === "tasks.read" || auditIntent === "task.query")
  ) {
    auditIntent = "unknown";
  }
  if (
    c.group === "task_write" &&
    expectedIntent === "unknown" &&
    auditSilverTaskWriteReadOnlyLeadBeforeExplicitDoUkolFolded(folded) &&
    (eng === "tasks.read" || auditIntent === "task.query")
  ) {
    auditIntent = "unknown";
  }
  if (
    c.group === "task_write" &&
    expectedIntent === "unknown" &&
    auditSilverTaskWriteNakupJedenUkolDeadlineFolded(folded) &&
    (eng === "tasks.read" || auditIntent === "task.query")
  ) {
    auditIntent = "unknown";
  }
  if (
    c.group === "task_write" &&
    expectedIntent === "unknown" &&
    auditSilverTaskWriteNeDoUkolLeadWorkLineFolded(folded) &&
    (eng === "tasks.read" || auditIntent === "task.query")
  ) {
    auditIntent = "unknown";
  }
  if (
    c.group === "note_write" &&
    expectedIntent === "unknown" &&
    c.meta &&
    c.meta.readWritePriorityGate
  ) {
    const dangerousWrite =
      (eng === "notes.create" && turn.processingState === "READY_TO_SAVE") ||
      (eng === "calendar.create" && turn.processingState === "READY_TO_SAVE") ||
      (eng === "tasks.create" && turn.processingState === "READY_TO_SAVE");
    if (dangerousWrite) {
      return { pass: false, cat: "write_when_negated", auditIntent, raw };
    }
    return { pass: true, cat: "", auditIntent, raw };
  }
  const calWriteHarness =
    semG === "calendar_write" || (c.group === "dirty_mobile_czech" && c.meta && c.meta.underlying === "calendar_write");
  if (calWriteHarness && expectedIntent === "unknown" && auditIntent === "calendar.query") {
    const semQUnk = calendarQuerySemantic(c.input, folded, turn, raw, "calendar.query");
    if (!semQUnk.ok) return { pass: false, cat: semQUnk.cat, auditIntent, raw };
    return { pass: true, cat: "", auditIntent, raw };
  }
  if (auditIntent === "unknown" || eng === "clarification") {
    if (expectedIntent === "calendar.query" && calWriteHarness) {
      const semQOv = calendarQuerySemantic(c.input, folded, turn, raw, "calendar.query");
      if (!semQOv.ok) return { pass: false, cat: semQOv.cat, auditIntent, raw };
      return { pass: true, cat: "", auditIntent, raw };
    }
    if (expectedIntent !== "unknown") {
      return { pass: false, cat: "intent_fail", auditIntent, raw };
    }
    if (
      c.group === "temporal_reasoning" ||
      c.group === "calendar_query" ||
      c.group === "task_query" ||
      c.group === "note_query"
    ) {
      if (turn.processingState === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create") {
        return { pass: false, cat: "query_created_write", auditIntent, raw };
      }
    }
    return { pass: true, cat: "", auditIntent, raw };
  }
  if (auditIntent !== expectedIntent) return { pass: false, cat: "intent_fail", auditIntent, raw };

  const g = semG;
  if (g === "calendar_write") {
    const sem = calendarWriteSemantic(turn, raw, folded);
    if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
  } else if (g === "task_write") {
    const sem = taskWriteSemantic(turn, raw, folded);
    if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
  } else if (g === "note_write") {
    const sem = noteWriteSemantic(turn, raw, folded);
    if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
  } else if (g === "calendar_query") {
    const sem = calendarQuerySemantic(c.input, folded, turn, raw, c.expectedIntent);
    if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
    const ts = temporalScopeCheck(c.meta, raw);
    if (!ts.ok) return { pass: false, cat: ts.cat, auditIntent, raw };
  } else if (g === "task_query") {
    const sem = taskQuerySemantic(c.input, folded, turn, raw, c.expectedIntent);
    if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
  } else if (g === "note_query") {
    const sem = noteQuerySemantic(c.input, folded, turn, raw, c.expectedIntent);
    if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
  }

  if ((c.group.indexOf("_query") > 0 || c.group === "safety_negation" || c.group === "temporal_reasoning") && hasNegWrite(folded)) {
    if (turn.processingState === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create") {
      return { pass: false, cat: "negative_instruction_fail", auditIntent, raw };
    }
  }

  return { pass: true, cat: "", auditIntent, raw };
}

function extraQualityTags(c, turn, ev) {
  const tags = [];
  if (!ev.pass) return tags;
  const folded = foldCs(c.input);
  const raw = ev.raw;
  const d = turn.draft || {};
  const eng = turn.normalizedIntent;

  if (c.group === "calendar_write" || (c.group === "dirty_mobile_czech" && c.meta && c.meta.underlying === "calendar_write")) {
    const tc = titleCleanForDraft(turn, folded);
    if (!tc.ok && !tc.skip) tags.push("dirty_title");
    const aq = addressQuality(turn, folded);
    if (!aq.ok && !aq.skip) tags.push("address_in_title_only");
    if (c.meta && c.meta.embed_needle) {
      const emb = embeddedNoteQuality(turn, foldCs(c.meta.embed_needle));
      if (!emb.ok) tags.push(emb.cat);
    }
    if (standaloneNoteCreateViolation(turn)) tags.push("standalone_note_create");
  }
  if (c.group === "task_write" || (c.group === "dirty_mobile_czech" && c.meta && c.meta.underlying === "task_write")) {
    const tc = titleCleanForDraft(turn, folded);
    if (!tc.ok && !tc.skip) tags.push("dirty_title");
    if (eng === "calendar.create") tags.push("task_calendar_confusion");
  }
  if (c.group === "note_write" || (c.group === "dirty_mobile_czech" && c.meta && c.meta.underlying === "note_write")) {
    const tc = titleCleanForDraft(turn, folded);
    if (!tc.ok && !tc.skip) tags.push("dirty_title");
  }
  if (c.group === "multi_intent" && c.meta && c.meta.embed_needle) {
    const emb = embeddedNoteQuality(turn, foldCs(c.meta.embed_needle));
    if (!emb.ok) tags.push(emb.cat);
  }
  return tags;
}

function auditIntentFor(turn, cat) {
  return engineToAuditIntent(turn.normalizedIntent, cat);
}

function severityFor(cat) {
  if (
    /query_created_write|write_when_negated|dangerous|false_write|update_risk_new_create|wrong_module_readonly|future_query_returns_past|past_query_ignored|negative_instruction_fail|standalone_note_create/.test(
      cat
    )
  )
    return "P0";
  if (/dirty_title|address_in_title|task_calendar|reminder_|completed|active_tasks|embedded|intent_fail|calendar_vs|note_vs|wrong_collection|query_wrong/.test(cat)) return "P1";
  return "P2";
}

function buildCases() {
  const cases = [];
  let gid = 0;
  function push(obj) {
    gid++;
    cases.push(
      Object.assign(
        {
          id: obj.group + "_" + String(gid).padStart(5, "0")
        },
        obj
      )
    );
  }

  for (let i = 0; i < 3500; i++) {
    const p = PERSONS[i % PERSONS.length];
    const a = ADDRS[(i * 3) % ADDRS.length];
    const neg = i % 3 === 0 ? NEGS[i % NEGS.length] + " " : "";
    const embedNeedle = ["výkres", "vykresy", "smlouv", "občank", "servisní", "modr"][i % 6];
    const lines = [
      `${neg}Zítra zubař v 15.`,
      `${neg}Dnes schůzka s Petrem v osm.`,
      `${neg}V pátek právník 10:30.`,
      `${neg}Příští středu doktor.`,
      `${neg}Hele prosím tě hoď mi na zítra kolem třetí schůzku s ${p}, potkáme se někde ${a} a do poznámky mi dej že mám vzít ty modrý desky k baráku.`,
      `${neg}Ulož mi zítra schůzku v 15:00 s panem Novákem, potkat se máme na Náměstí Míru a do poznámky mi přidej, že si mám vzít výkresy k rodinnému domu.`,
      `${neg}Hoď mi prosím do kalendáře na příští úterý odpoledne schůzku s právníkem, bude to v Praze na Korunní 44 a do poznámky dej, že mám vzít smlouvu, občanku a kopii usnesení.`,
      `${neg}Dej mi do kalendáře, že v pátek ráno musím odvést auto do servisu v Ostravě na ulici Hlavní 12 a připomeň mi, že mám vzít servisní knížku.`,
      `${neg}hod mi zitra v 15 schuzku s pravnikem na korunovacni 44 praha`,
      `${neg}pripomen mi v kalendari ze musim v patek rano k zubari`,
      `${neg}dej mi do kalendare pristi stredu schuzku s novakem na namesti miru`,
      `${neg}Hoť mi do kalendáře zítra schůzku s právníkem.`,
      `${neg}Pripomen mi že mám zitra doktora.`,
      `${neg}Uloš mi do kalendaře schuzku s Petrem.`,
      `${neg}Vlastně sorry zrus to — ne, počkej: ${neg}ulož mi zítra v 16 schůzku s ${p} na ${a}, poznámka: donést výkresy.`
    ];
    const inp = diacVariant(i, lines[i % lines.length]);
    const meta = i % 4 === 0 ? { embed_needle: embedNeedle } : {};
    const expCalW = calendarWriteHarnessExpectedIntent(foldCs(inp));
    push({ group: "calendar_write", input: inp, expectedIntent: expCalW, meta });
  }

  for (let i = 0; i < 3500; i++) {
    const p = PERSONS[(i * 2) % PERSONS.length];
    const neg = NEGS[(i + 1) % NEGS.length];
    const futureLines = [
      `Kdy mám schůzku s právníkem?`,
      `Kdy mám další schůzku u zubaře?`,
      `Kdy jdu příště k doktorovi?`,
      `Co mám zítra v kalendáři?`,
      `Co mě čeká příští týden?`,
      `Kdy mám nejbližší schůzku s panem Novákem?`,
      `${neg} Kdy mám ${p} zitra v kalendari?`
    ];
    const pastLines = [
      `Kdy jsem měl schůzku s právníkem?`,
      `Kdy jsem byl naposledy u zubaře?`,
      `Kolikrát jsem byl letos u zubaře?`,
      `Kolik jsem měl letos schůzek s právníkem?`,
      `Kdy jsem měl poslední schůzku s Petrem?`,
      `Co jsem měl minulý týden v kalendáři?`
    ];
    const presentLines = [`Co mám dnes?`, `Co mám dnes v kalendáři?`, `Mám dnes nějakou schůzku?`, `Mám teď něco?`];
    let inp;
    let meta = {};
    const bucket = i % 3;
    if (bucket === 0) {
      inp = diacVariant(i, futureLines[i % futureLines.length]);
      meta = { time_scope: "future", folded_probe: foldCs(inp) };
    } else if (bucket === 1) {
      inp = diacVariant(i, pastLines[i % pastLines.length]);
      meta = { time_scope: "past", folded_probe: foldCs(inp) };
    } else {
      inp = diacVariant(i, presentLines[i % presentLines.length]);
      meta = { time_scope: "present", folded_probe: foldCs(inp) };
    }
    const exp = i % 17 === 0 && bucket === 0 ? "note.query" : "calendar.query";
    push({ group: "calendar_query", input: inp, expectedIntent: exp, meta });
  }

  for (let i = 0; i < 4000; i++) {
    const neg = i % 13 === 0 ? NEGS[i % NEGS.length] + " " : "";
    const lines = [
      `${neg}Přidej úkol zaplatit elektřinu.`,
      `${neg}Musím zítra zavolat právníkovi.`,
      `${neg}Nesmím zapomenout koupit léky.`,
      `${neg}Připomeň mi koupit mléko.`,
      `${neg}Zapiš mi úkol, že mám v pátek poslat fakturu.`,
      `${neg}Hele napiš mi prosím úkol, že mám do pondělí poslat Petrovi ty dokumenty, ale nedávej to do kalendáře.`,
      `${neg}ukol: koupit rohliky, ne kalendář.`,
      `${neg}nezapomenout zavolat ucetni, jen ukol.`
    ];
    push({ group: "task_write", input: diacVariant(i, lines[i % lines.length]), expectedIntent: "task.create", meta: {} });
  }

  for (let i = 0; i < 4000; i++) {
    const neg = NEGS[(i + 3) % NEGS.length];
    const active = [
      `Jaké mám úkoly?`,
      `Co mám dnes za úkoly?`,
      `Co musím dnes udělat?`,
      `Vypiš mi dnešní úkoly.`,
      `Jen se podívej do úkolů, ne do kalendáře, nic neukládej.`,
      `${neg} Co mam v ukolech na dnes?`
    ];
    const done = [
      `Vypiš mi hotové úkoly.`,
      `Co už mám splněno?`,
      `Které úkoly jsem dokončil?`,
      `Co jsem tento týden odškrtl?`,
      `Najdi hotové úkoly k právníkovi.`
    ];
    const undone = [`Vypiš mi nesplněné úkoly.`, `Co mi ještě zbývá?`, `Co jsem ještě neudělal?`];
    let inp;
    let meta = {};
    if (i % 3 === 0) {
      inp = diacVariant(i, active[i % active.length]);
      meta = { task_query_kind: "active" };
    } else if (i % 3 === 1) {
      inp = diacVariant(i, done[i % done.length]);
      meta = { task_query_kind: "completed" };
    } else {
      inp = diacVariant(i, undone[i % undone.length]);
      meta = { task_query_kind: "unspecified" };
    }
    push({ group: "task_query", input: inp, expectedIntent: "task.query", meta });
  }

  for (let i = 0; i < 3500; i++) {
    const neg = i % 2 === 0 ? "" : NEGS[(i + 5) % NEGS.length] + " ";
    const lines = [
      `${neg}Napiš si do poznámek heslo k Wi-Fi je ABCD.`,
      `${neg}Ulož poznámku, že auto má barvu modrou.`,
      `${neg}Zapamatuj si, že Petr má číslo účtu 123.`,
      `${neg}Napiš si, že u smlouvy s Novákem mám zkontrolovat článek 4.`,
      `${neg}Ulož mi poznámku k domu, že střecha byla opravena v roce 2023.`,
      `${neg}poznamka: pin karte 4321, ne ukol.`
    ];
    push({ group: "note_write", input: diacVariant(i, lines[i % lines.length]), expectedIntent: "note.create", meta: {} });
  }

  for (let i = 0; i < 3500; i++) {
    const neg = NEGS[(i + 2) % NEGS.length];
    const lines = [
      `Jaké mám heslo k Wi-Fi?`,
      `Najdi mi poznámku k autu.`,
      `Co jsem si poznamenal o Petrovi?`,
      `Jakou barvu mělo auto?`,
      `Co mám uložené ke smlouvě s Novákem?`,
      `Najdi poznámku o rodinném domě.`,
      `${neg} najdi v poznamkach wifi`
    ];
    push({ group: "note_query", input: diacVariant(i, lines[i % lines.length]), expectedIntent: "note.query", meta: {} });
  }

  for (let i = 0; i < 2000; i++) {
    const neg = NEGS[i % NEGS.length];
    const lines = [
      `Ulož mi zítra schůzku s právníkem v 15:00 na Korunní 44 a do poznámky k události dej, že mám vzít smlouvu.`,
      `Přidej mi úkol zavolat Petrovi a zároveň si do poznámek napiš, že chce řešit střechu.`,
      `Zítra mám v 10 zubaře a pak mi připomeň koupit mléko.`,
      `Hoď mi do kalendáře schůzku s Novákem a jako úkol mi napiš, že mu mám poslat podklady.`,
      `${neg} kalendář zítra 9 účetní a úkol koupit uhlí, nic do kalendáře pro uhlí.`
    ];
    const inp = diacVariant(i, lines[i % lines.length]);
    const f = foldCs(inp);
    const needsDualWrite =
      /zároveň|zaroven|a\s+zároveň|a\s+zaroven/i.test(inp) &&
      /\bdo\s+poznam|\bpoznam|\bdo\s+kalend|\bdo\s+ukol|\buloz|\bulož|\bpridej|\bpřidej/i.test(f);
    const queryNeg = /jen\s+se\s+podivej|jen\s+cti|nic\s+neuklad/.test(f) ? f : "";
    const meta = { needsDualWrite, queryNeg, embed_needle: i % 2 === 0 ? "smlouv" : "" };
    push({ group: "multi_intent", input: inp, expectedIntent: "unknown", meta });
  }

  for (let i = 0; i < 2000; i++) {
    const templates = [
      { inp: "Nic neukládej, jen zjisti kdy mám zubaře.", exp: "calendar.query", sem: "calendar_query" },
      { inp: "Jen se podívej do úkolů, ne do kalendáře, nic neukládej.", exp: "task.query", sem: "task_query" },
      { inp: "Neukládej to, jen mi řekni co mám dnes.", exp: "flexible_read", sem: "calendar_query" },
      { inp: "Jen čti, nic nevytvářej. Co mám zítra?", exp: "calendar.query", sem: "calendar_query" },
      { inp: "Ne do úkolů, podívej se do kalendáře na právníka.", exp: "calendar.query", sem: "calendar_query" },
      { inp: "Ne do kalendáře, najdi mi to v úkolech koupit mléko.", exp: "task.query", sem: "task_query" },
      { inp: "nic neukladej jen vypis co mam v poznamkach o aute", exp: "note.query", sem: "note_query" }
    ];
    const t = templates[i % templates.length];
    push({
      group: "safety_negation",
      input: t.inp,
      expectedIntent: t.exp,
      meta: { semantic_as: t.sem }
    });
  }

  for (let i = 0; i < 1000; i++) {
    const lines = [
      "Posuň schůzku s Petrem na 16:00.",
      "Přesuň zítřejší schůzku s Jakubem na pátek dopoledne.",
      "Změň čas schůzky s právníkem na 17:30.",
      "Přehoď mi zítřejší schůzku s doktorem o hodinu později.",
      "Posuňme tu schůzku s Novákem na čtvrtek.",
      "Uprav mi zítřejší schůzku, ať je až v pět."
    ];
    push({ group: "update_vs_create", input: diacVariant(i, lines[i % lines.length]), expectedIntent: "non_create_ok", meta: {} });
  }

  for (let i = 0; i < 1000; i++) {
    const calT = [
      "Připomeň mi zítra v 15:00 zubaře.",
      "Připomeň mi 10 minut před schůzkou s právníkem.",
      "Připomeň mi v pátek v osm ráno jogu."
    ];
    const taskT = ["Připomeň mi koupit mléko.", "Připomeň mi zavolat Petrovi.", "Připomeň mi zaplatit fakturu."];
    const miss = ["Připomeň mi právníka.", "Připomeň mi schůzku s Novákem."];
    const r = i % 5;
    if (r < 2) {
      push({
        group: "reminder_intent",
        input: calT[i % calT.length],
        expectedIntent: "calendar.create",
        meta: { reminder_kind: "calendar", reminder_target: "calendar", needs_seed: r === 1 }
      });
    } else if (r < 4) {
      push({
        group: "reminder_intent",
        input: taskT[i % taskT.length],
        expectedIntent: "task.create",
        meta: { reminder_kind: "task", reminder_target: "task" }
      });
    } else {
      push({
        group: "reminder_intent",
        input: miss[i % miss.length],
        expectedIntent: "unknown",
        meta: { reminder_kind: "missing_time", reminder_target: "calendar", needs_seed: false }
      });
    }
  }

  const temporalMandatory = [
    "Kdy mám další schůzku u zubaře?",
    "Kdy jsem měl poslední schůzku u zubaře?",
    "Kolikrát jsem byl letos u zubaře?",
    "Kolik schůzek s právníkem jsem měl minulý měsíc?",
    "Co mě čeká příští týden?",
    "Co jsem měl minulý týden?",
    "Mám dnes něco?",
    "Měl jsem včera něco?",
    "Budu mít v pátek nějakou schůzku?"
  ];
  for (let i = 0; i < 1000; i++) {
    const base = temporalMandatory[i % temporalMandatory.length];
    const counting = /Kolik|kolikrát/i.test(base);
    const ts = /jsem měl|minulý|včera|Kolik/i.test(base) ? "past" : /další|příští|čeká|Budu|dnes|Mám dnes/i.test(base) ? "future" : "present";
    push({
      group: "temporal_reasoning",
      input: diacVariant(i, base + (i % 7 === 0 ? " " + NEGS[0] + "." : "")),
      expectedIntent: counting ? "unknown" : "calendar.query",
      meta: { time_scope: counting ? undefined : ts, counting_query: counting, folded_probe: foldCs(base) }
    });
  }

  for (let i = 0; i < 1000; i++) {
    const dirtyW = [
      "hod mi zejtra schuzku s pravnikem v 15 a do poznamky dej smlouvu",
      "pripomen mi ze mam v patek rano zubare",
      "dej mi do kalendare ze mam zitra v osm jogu"
    ];
    const dirtyQ = [
      "hele najdi mi kdy mam zas doktora",
      "koukni do ukolu co mam dneska udelat nic neukladej",
      "vypis hotovy ukoly",
      "kdy sem byl naposled u zubare",
      "kolikrat sem mel letos pravnika"
    ];
    if (i % 2 === 0) {
      push({
        group: "dirty_mobile_czech",
        input: dirtyW[i % dirtyW.length],
        expectedIntent: "calendar.create",
        meta: { underlying: "calendar_write", secondary_tags: ["calendar_write"], embed_needle: "smlouv" }
      });
    } else {
      const inp = dirtyQ[i % dirtyQ.length];
      const isTask = /ukol|hotov/i.test(inp);
      push({
        group: "dirty_mobile_czech",
        input: inp,
        expectedIntent: isTask ? "task.query" : "calendar.query",
        meta: { underlying: isTask ? "task_query" : "calendar_query", is_query: true, secondary_tags: [isTask ? "task_query" : "calendar_query"] }
      });
    }
  }

  for (let twi = 0; twi < cases.length; twi++) {
    const twc = cases[twi];
    if (twc.group !== "task_write") continue;
    if (auditSilverTaskWriteReadOnlyNegVsExplicitJedenUkolFolded(foldCs(twc.input))) {
      twc.expectedIntent = "unknown";
      twc.meta = Object.assign({}, twc.meta || {}, { readWritePriorityGate: true });
    }
    if (auditSilverTaskWriteReadOnlyLeadBeforeExplicitDoUkolFolded(foldCs(twc.input))) {
      twc.expectedIntent = "unknown";
      twc.meta = Object.assign({}, twc.meta || {}, { readWritePriorityGate: true });
    }
    if (auditSilverTaskWriteNakupJedenUkolDeadlineFolded(foldCs(twc.input))) {
      twc.expectedIntent = "unknown";
      twc.meta = Object.assign({}, twc.meta || {}, { readWritePriorityGate: true });
    }
    if (auditSilverTaskWriteNeDoUkolLeadWorkLineFolded(foldCs(twc.input))) {
      twc.expectedIntent = "unknown";
      twc.meta = Object.assign({}, twc.meta || {}, { readWritePriorityGate: true });
    }
  }
  for (let nwi = 0; nwi < cases.length; nwi++) {
    const nwc = cases[nwi];
    if (nwc.group !== "note_write") continue;
    const fNw = foldCs(nwc.input);
    if (auditSilverNoteWriteReadOnlyVersusExplicitWriteFolded(fNw) || noteWriteCalendarScopeNegationExpectNoWriteFolded(fNw)) {
      nwc.expectedIntent = "unknown";
      nwc.meta = Object.assign({}, nwc.meta || {}, { readWritePriorityGate: true });
    }
  }

  return cases;
}

function pct(a, b) {
  if (!b) return "0.00";
  return ((100 * a) / b).toFixed(2);
}

function isP1QualityTag(t) {
  return /dirty_title|address_in_title|standalone_note_create|embedded_not_calendar|embedded_note_missing|task_calendar_confusion/.test(t);
}

function main() {
  const git = gitTrackedClean();
  if (!git.ok) {
    console.log("=== SILVER_REAL_UX_AUDIT_ABORT ===");
    console.log("reason=tracked_files_dirty");
    console.log(git.porcelain);
    console.log("==== END_ABORT ====");
    process.exit(1);
  }

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const cases = buildCases();
  if (cases.length !== TOTAL) {
    console.log("seed_data_fail=expected_" + TOTAL + "_got_" + cases.length);
    process.exit(1);
  }

  const clusterMap = new Map();
  const clusterExamples = new Map();
  const byGroup = {};
  const groups = [
    "calendar_write",
    "calendar_query",
    "task_write",
    "task_query",
    "note_write",
    "note_query",
    "multi_intent",
    "safety_negation",
    "update_vs_create",
    "reminder_intent",
    "temporal_reasoning",
    "dirty_mobile_czech"
  ];
  for (let gi = 0; gi < groups.length; gi++) {
    byGroup[groups[gi]] = { pass: 0, fail: 0, core_pass: 0, quality_fail: 0 };
  }

  let dangerousWriteCount = 0;
  let falseWriteCount = 0;
  let queryCreatedWriteCount = 0;
  let writeWhenNegatedCount = 0;
  let updateRiskNewCreateCount = 0;

  let pastNum = 0;
  let pastPass = 0;
  let futureNum = 0;
  let futurePass = 0;
  let presentNum = 0;
  let presentPass = 0;
  let countingNum = 0;
  let countingPass = 0;

  let titleDenom = 0;
  let titlePass = 0;
  let addrDenom = 0;
  let addrPass = 0;
  let embDenom = 0;
  let embPass = 0;
  let completedTaskNum = 0;
  let completedTaskPass = 0;
  let activeTaskNum = 0;
  let activeTaskPass = 0;

  let writePass = 0;
  let writeDenom = 0;
  let queryPass = 0;
  let queryDenom = 0;

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e) {
      void e;
    }
    const empty = eng.createEmptyDraft();
    let turn;
    try {
      turn = eng.processUserTurn(c.input, empty, ctxForCase(c));
    } catch (err) {
      const cat = "runtime_fail";
      byGroup[c.group].fail++;
      const key = cat + "|" + c.group;
      clusterMap.set(key, (clusterMap.get(key) || 0) + 1);
      if (!clusterExamples.has(key)) clusterExamples.set(key, []);
      const arr = clusterExamples.get(key);
      if (arr.length < 10) arr.push({ input: c.input.slice(0, 200), expected: c.expectedIntent, actual: String(err && err.message) });
      continue;
    }

    const folded = foldCs(c.input);
    const ev = evaluateCore(c, turn);
    const qtags = extraQualityTags(c, turn, ev);
    const corePass = ev.pass;
    const qualityHard = qtags.some((t) => isP1QualityTag(t));
    const fullPass = corePass && !qualityHard;

    if (c.group.indexOf("_write") > 0 || c.group === "calendar_write" || c.group === "multi_intent" || c.group === "reminder_intent") {
      writeDenom++;
      if (corePass) writePass++;
    }
    if (c.group.indexOf("_query") > 0 || c.group === "calendar_query" || c.group === "safety_negation" || c.group === "temporal_reasoning") {
      queryDenom++;
      if (corePass) queryPass++;
    }

    const createLike = createLikeTurn(turn);
    const queryLikeGroup =
      c.group === "calendar_query" ||
      c.group === "task_query" ||
      c.group === "note_query" ||
      c.group === "safety_negation" ||
      c.group === "temporal_reasoning";
    if (queryLikeGroup && hasNegWrite(folded) && createLike) dangerousWriteCount++;
    if (queryLikeGroup && createLike) {
      falseWriteCount++;
      queryCreatedWriteCount++;
    }
    if (c.group === "safety_negation" && createLike) writeWhenNegatedCount++;
    if (ev.cat === "update_risk_new_create") updateRiskNewCreateCount++;

    if (c.group === "calendar_query" || c.group === "temporal_reasoning") {
      const ts = c.meta && c.meta.time_scope;
      if (ts === "past") {
        pastNum++;
        if (corePass && temporalScopeCheck(c.meta, ev.raw).ok) pastPass++;
      } else if (ts === "future") {
        futureNum++;
        if (corePass && temporalScopeCheck(c.meta, ev.raw).ok) futurePass++;
      } else if (ts === "present") {
        presentNum++;
        if (corePass && temporalScopeCheck(c.meta, ev.raw).ok) presentPass++;
      }
      if (c.meta && c.meta.counting_query) {
        countingNum++;
        if (corePass) countingPass++;
      }
    }

    if (c.group === "task_query") {
      if (c.meta && c.meta.task_query_kind === "completed") {
        completedTaskNum++;
        if (corePass) completedTaskPass++;
      }
      if (c.meta && c.meta.task_query_kind === "active") {
        activeTaskNum++;
        if (corePass) activeTaskPass++;
      }
    }

    if (
      c.group === "calendar_write" ||
      (c.group === "dirty_mobile_czech" && c.meta && c.meta.underlying === "calendar_write") ||
      c.group === "task_write" ||
      (c.group === "dirty_mobile_czech" && c.meta && c.meta.underlying === "task_write") ||
      c.group === "note_write" ||
      (c.group === "dirty_mobile_czech" && c.meta && c.meta.underlying === "note_write")
    ) {
      const tc = titleCleanForDraft(turn, folded);
      if (!tc.skip) {
        titleDenom++;
        if (tc.ok && qtags.indexOf("dirty_title") < 0) titlePass++;
      }
      const aq = addressQuality(turn, folded);
      if (!aq.skip) {
        addrDenom++;
        if (aq.ok && qtags.indexOf("address_in_title_only") < 0) addrPass++;
      }
    }

    if (c.meta && c.meta.embed_needle) {
      embDenom++;
      const embBad = qtags.some((t) => /embedded|standalone_note_create/.test(t));
      if (corePass && !embBad) embPass++;
    }

    if (fullPass) {
      byGroup[c.group].pass++;
      byGroup[c.group].core_pass++;
    } else {
      byGroup[c.group].fail++;
      if (corePass) byGroup[c.group].quality_fail++;
      const primaryCat = ev.pass ? qtags[0] || "quality_fail" : ev.cat || "intent_fail";
      const key = primaryCat + "|" + c.group;
      clusterMap.set(key, (clusterMap.get(key) || 0) + 1);
      if (!clusterExamples.has(key)) clusterExamples.set(key, []);
      const ex = clusterExamples.get(key);
      if (ex.length < 10) {
        ex.push({
          input: c.input.slice(0, 220),
          expected_summary: c.expectedIntent + (c.meta && c.meta.secondary_tags ? " secondary=" + c.meta.secondary_tags.join(",") : ""),
          actual_summary: (turn.normalizedIntent || "") + "/" + (turn.processingState || "") + " :: " + (ev.raw || "").slice(0, 120)
        });
      }
    }
  }

  let sumPass = 0;
  for (let gi = 0; gi < groups.length; gi++) sumPass += byGroup[groups[gi]].pass;
  const overallAcc = pct(sumPass, TOTAL);

  const topClusters = Array.from(clusterMap.entries())
    .map(([k, n]) => ({ k, n }))
    .sort((a, b) => b.n - a.n || a.k.localeCompare(b.k))
    .slice(0, 25);

  const top25 = topClusters.map((x) => {
    const parts = x.k.split("|");
    const cat = parts[0];
    const mod = parts[1] || "";
    const ex = clusterExamples.get(x.k) || [];
    return {
      cluster_name: x.k,
      fail_count: x.n,
      severity: severityFor(cat),
      affected_module: mod,
      example_inputs: ex.map((e) => e.input),
      expected_summary: ex[0] ? ex[0].expected_summary : "",
      actual_summary: ex[0] ? ex[0].actual_summary : "",
      root_cause_guess: "Harness mismatch or Silver routing/semantic gap on chaotic Czech phrasing (audit-only).",
      recommended_next_scope: "Narrow Silver change in " + mod + " for pattern «" + cat + "» (do not broaden unrelated modules).",
      must_not_touch: "assets/app.js only via deliberate engine PR; this audit PR stays scripts-only."
    };
  });

  let recommended_next_fix_cluster = "";
  let recommended_next_fix_reason = "";
  let exact_next_scope = "";
  if (topClusters.length) {
    recommended_next_fix_cluster = topClusters[0].k;
    recommended_next_fix_reason =
      "Largest cluster «" + topClusters[0].k + "» (" + topClusters[0].n + " fails); fix routing/semantics for this phrasing family first.";
    exact_next_scope = "Silver engine: handle «" + topClusters[0].k.split("|")[0] + "» in module «" + (topClusters[0].k.split("|")[1] || "") + "».";
  }

  let peerQuality = null;
  let peer20k = null;
  let peerRealistic = null;
  try {
    const qPath = path.join(__dirname, "silver-quality-v2-report.json");
    if (fs.existsSync(qPath)) peerQuality = JSON.parse(fs.readFileSync(qPath, "utf8")).quality_accuracy || null;
  } catch (e) {
    void e;
  }
  try {
    const rPath = path.join(__dirname, "silver-realistic-mobile-corpus-report.json");
    if (fs.existsSync(rPath)) {
      const rj = JSON.parse(fs.readFileSync(rPath, "utf8"));
      peerRealistic = rj.overall_accuracy_realistic || rj.routing_accuracy || null;
    }
  } catch (e) {
    void e;
  }

  const report = {
    harness_id: HARNESS_ID,
    fixed_now: FIXED_NOW_ISO,
    partition_note:
      "Requested bucket sum was 33500; normalized to 30000 by calendar_write=3500, calendar_query=3500, multi_intent=2000 (other buckets unchanged).",
    total_cases: TOTAL,
    overall_accuracy: overallAcc,
    calendar_write_accuracy: pct(byGroup.calendar_write.pass, byGroup.calendar_write.pass + byGroup.calendar_write.fail),
    calendar_query_accuracy: pct(byGroup.calendar_query.pass, byGroup.calendar_query.pass + byGroup.calendar_query.fail),
    task_write_accuracy: pct(byGroup.task_write.pass, byGroup.task_write.pass + byGroup.task_write.fail),
    task_query_accuracy: pct(byGroup.task_query.pass, byGroup.task_query.pass + byGroup.task_query.fail),
    note_write_accuracy: pct(byGroup.note_write.pass, byGroup.note_write.pass + byGroup.note_write.fail),
    note_query_accuracy: pct(byGroup.note_query.pass, byGroup.note_query.pass + byGroup.note_query.fail),
    multi_intent_accuracy: pct(byGroup.multi_intent.pass, byGroup.multi_intent.pass + byGroup.multi_intent.fail),
    safety_negation_accuracy: pct(byGroup.safety_negation.pass, byGroup.safety_negation.pass + byGroup.safety_negation.fail),
    update_vs_create_accuracy: pct(byGroup.update_vs_create.pass, byGroup.update_vs_create.pass + byGroup.update_vs_create.fail),
    reminder_intent_accuracy: pct(byGroup.reminder_intent.pass, byGroup.reminder_intent.pass + byGroup.reminder_intent.fail),
    temporal_reasoning_accuracy: pct(byGroup.temporal_reasoning.pass, byGroup.temporal_reasoning.pass + byGroup.temporal_reasoning.fail),
    dirty_mobile_czech_accuracy: pct(byGroup.dirty_mobile_czech.pass, byGroup.dirty_mobile_czech.pass + byGroup.dirty_mobile_czech.fail),
    past_query_accuracy: pct(pastPass, pastNum),
    future_query_accuracy: pct(futurePass, futureNum),
    present_query_accuracy: pct(presentPass, presentNum),
    counting_query_accuracy: pct(countingPass, countingNum),
    title_cleanliness_accuracy: pct(titlePass, titleDenom),
    address_location_accuracy: pct(addrPass, addrDenom),
    embedded_note_tail_accuracy: pct(embPass, embDenom),
    completed_tasks_query_accuracy: pct(completedTaskPass, completedTaskNum),
    active_tasks_query_accuracy: pct(activeTaskPass, activeTaskNum),
    write_accuracy: pct(writePass, writeDenom),
    query_accuracy: pct(queryPass, queryDenom),
    update_risk_new_create_count: updateRiskNewCreateCount,
    dangerous_write_count: dangerousWriteCount,
    false_write_count: falseWriteCount,
    query_created_write_count: queryCreatedWriteCount,
    write_when_negated_count: writeWhenNegatedCount,
    top_25_fail_clusters: top25,
    recommended_next_fix_cluster: recommended_next_fix_cluster,
    recommended_next_fix_reason: recommended_next_fix_reason,
    exact_next_scope: exact_next_scope,
    peer_quality_accuracy: peerQuality,
    peer_realistic_routing_accuracy: peerRealistic,
    peer_20k_overall_accuracy: peer20k,
    by_group: byGroup
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  const lines = [
    "=== SILVER_REAL_UX_AUDIT_V1_SUMMARY ===",
    "harness_id=" + HARNESS_ID,
    "total_cases=" + TOTAL,
    "overall_accuracy=" + overallAcc + "%",
    "query_created_write_count=" + queryCreatedWriteCount,
    "dangerous_write_count=" + dangerousWriteCount,
    "update_risk_new_create_count=" + updateRiskNewCreateCount,
    "report_json=" + REPORT_JSON,
    "=== END_SUMMARY ==="
  ];
  console.log(lines.join("\n"));
}

main();
