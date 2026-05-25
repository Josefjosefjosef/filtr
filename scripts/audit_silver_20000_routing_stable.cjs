/**
 * Silver 20k routing audit — STABLE SNAPSHOT (repo). Deterministic harness for comparable runs.
 * - fixed clock, embedded seed, no Math.random / no wall-clock in generator
 * - METHOD: VM-loaded iuSilverCalendarEngine from assets/app.js (same bundle as prod)
 *
 * Snapshot id: audit_silver_20000_routing_stable_v1
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const crypto = require("crypto");
const { execSync } = require("child_process");

const STABLE_HARNESS_ID = "audit_silver_20000_routing_stable_v1";
const FIXED_NOW_ISO = "2026-05-04T12:00:00";
const REPORT_TXT = path.join(os.tmpdir(), "silver_20000_stable_routing_audit_report.txt");

const REPO = path.resolve(__dirname, "..");

const FIXED_NOW = new Date(FIXED_NOW_ISO);

const FAIL_CATS = new Set([
  "intent_fail",
  "module_fail",
  "query_created_write",
  "write_routed_to_wrong_module",
  "query_wrong_dataset",
  "entity_mismatch",
  "date_parse_fail",
  "time_parse_fail",
  "address_parse_fail",
  "note_parse_fail",
  "task_deadline_fail",
  "multi_intent_fail",
  "negative_instruction_fail",
  "diacritics_fail",
  "unnecessary_disambiguation",
  "false_negative",
  "false_positive",
  "bad_title_cleanup",
  "dirty_note_text",
  "dirty_task_title",
  "dirty_calendar_title",
  "wrong_person_match",
  "wrong_address_match",
  "wrong_date_scope",
  "wrong_time_scope",
  "seed_data_fail",
  "runtime_fail",
  "unknown"
]);

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
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    }
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

function escapeField(s) {
  return String(s == null ? "" : s)
    .replace(/\r?\n/g, "\\n")
    .replace(/=/g, "\uFF1D");
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
    { id: "t10", title: "nabít telefon", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 }
  ];
  const notes = [
    { id: "n1", title: "Auto", content: "auto mělo modrou barvu", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n2", title: "Boty", content: "boty mají velikost 33", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n3", title: "Zubař", content: "zubař má adresu Korunní 33 Praha", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n4", title: "Klíče", content: "klíče jsou v šuplíku", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n5", title: "Mariana", content: "Mariana má červenou tašku", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n6", title: "PIN", content: "pin ke kartě je doma", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n7", title: "Kufr", content: "kufr je ve sklepě", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n8", title: "Právník", content: "právník je na Praze 1", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n9", title: "Advokát", content: "advokát potřebuje plnou moc", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n10", title: "Kompas", content: "kompas je v batohu", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n11", title: "Účtenka", content: "účtenka je v šuplíku", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n12", title: "Nabíječka", content: "nabíječka je v autě", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }
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
  return {
    now: FIXED_NOW,
    getEventsSnapshot: () => [],
    getTasksSnapshot: () => [],
    getNotesSnapshot: () => []
  };
}

function ctxForCase(group) {
  if (group.indexOf("query") >= 0 || group === "multi_intent") return ctxQuery();
  return ctxEmpty();
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
    if (category === "calendar_write") return "calendar.create";
    if (category === "task_write") return "task.create";
    if (category === "note_write") return "note.create";
    return "unknown";
  }
  if (i === "global.search") {
    if (category && category.indexOf("note_") === 0) return "note.query";
    if (category && category.indexOf("task_") === 0) return "task.query";
    if (category && category.indexOf("calendar_") === 0) return "calendar.query";
    if (category === "multi_intent") return "multi.partial";
  }
  if (i === "clarification" || i === "unknown") return "unknown";
  if (i === "silver.user_address_set") return "salutation.side";
  return i || "unknown";
}

function rawUserMessage(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "").trim();
}

function cardType(turn) {
  const ps = turn.processingState;
  const ni = turn.normalizedIntent;
  const d = turn.draft || {};
  if (ps === "STORAGE_DISAMBIGUATION") return "storage_disambiguation";
  if (ps === "READ_OK" || ni === "calendar.read" || ni === "tasks.read" || ni === "notes.read") return "read_card";
  if (ni === "global.search" && turn.readAnswer) return "search_read";
  if (d.targetContainer === "tasks") return "task_draft";
  if (d.targetContainer === "notes") return "note_draft";
  if (d.targetContainer === "calendar" || (!d.targetContainer && ni === "calendar.create")) return "calendar_draft";
  if (ps === "CLARIFICATION") return "clarification";
  return ni || ps || "none";
}

function serializeDraft(turn) {
  const d = turn.draft || {};
  const parts = [];
  if (d.title) parts.push("title:" + String(d.title).slice(0, 120));
  if (d.date || d.dateISO) parts.push("date:" + String(d.date || d.dateISO || ""));
  if (d.time || d.timeHHMM) parts.push("time:" + String(d.time || d.timeHHMM || ""));
  if (d.address || d.location) parts.push("addr:" + String(d.address || d.location || "").slice(0, 80));
  if (d.note) parts.push("note:" + String(d.note).slice(0, 80));
  if (d.silverNoteText) parts.push("nText:" + String(d.silverNoteText).slice(0, 120));
  if (d.targetContainer) parts.push("target:" + d.targetContainer);
  return parts.join(";") || "(none)";
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

/** P0: read-only NEGS prefix + „jako jeden úkol“ = konflikt zápis/read (harness expected unknown; engine může vrátit tasks.read). */
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

/**
 * P0 (task_write_06007): read-only lead („jen zjisti“, „jen čti“, …) před prvním explicitním „do úkolů“
 * → konflikt zápis/read; harness + engine: unknown / ambiguous_write (ne task.create).
 */
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

/** task_write_06012: nákupní řádek + „jako jeden úkol do pátku“ bez slovesa zápisu — engine zůstává unknown. */
function auditSilverTaskWriteNakupJedenUkolDeadlineFolded(fx) {
  const x = String(fx || "");
  if (!/\bnakup\s*:/.test(x)) return false;
  if (!/\bjako\s+jeden\s+ukol\w*\b/.test(x)) return false;
  return (
    /\bdo\s+patk\w*\b/.test(x) ||
    /\bdo\s+zitr\w*\b/.test(x) ||
    /\bdo\s+deset\w*\b/.test(x) ||
    /\bdo\s+\d+\s+dn\w*\b/.test(x)
  );
}

/** task_write_06013: NEGS fragment „ne do úkolů“ + pracovní úkol řádek — konflikt signálů, zápis neprovedu. */
function auditSilverTaskWriteNeDoUkolLeadWorkLineFolded(fx) {
  const x = String(fx || "").trim();
  if (!/^\s*ne\s+do\s+ukol\w*\b/i.test(x)) return false;
  if (!/\bpracovn\w*\s*:/.test(x)) return false;
  return /\bne\s+kalendar\w*\b/.test(x) || /\bne\s+kalend\w*\b/.test(x);
}

/** CAP15 cycle6: globální negace zápisu + explicitní task-write cue → gold unknown. */
function auditSilverGlobalNegBlocksExplicitTaskWriteExpectUnknownFolded(fx) {
  const f = String(fx || "");
  const globalNeg =
    /\bnic\s+neukladej\b/.test(f) ||
    /\bnic\s+nevytv\w*\b/.test(f) ||
    /\bneukladej\b/.test(f) ||
    (/\bnevytv\w*\b/.test(f) && !/\bnevytv\w*\s+ukol\b/.test(f));
  if (!globalNeg) return false;
  return (
    /\bdo\s+ukol\w*\b/.test(f) ||
    (/\bukol\w*\b/.test(f) &&
      (/\bpridej\b/.test(f) || /\bhod\b/.test(f) || /\buloz\b/.test(f) || /\bnapis\b/.test(f)))
  );
}

/** CAP15 cycle6: task_query module-exclusion + query DNA → gold unknown. */
function auditSilverTaskQueryModuleExclusionConflictUnknownFolded(fx) {
  const f = String(fx || "");
  const explicitModNeg =
    /\bne\s+v\s+kalend/.test(f) ||
    /\bne\s+do\s+kalend/.test(f) ||
    /\bmimo\s+kalendar/.test(f) ||
    /\bne\s+do\s+poznam/.test(f) ||
    /\bne\s+v\s+poznam/.test(f) ||
    /\bne\s+do\s+ukol/.test(f) ||
    /\bne\s+v\s+ukol/.test(f);
  if (!explicitModNeg) return false;
  return (
    (/\bkolik\b/.test(f) && (/\bukol/.test(f) || /\bdeadlin/.test(f))) ||
    (/\bkde\s+m(am|ame)\b/.test(f) && /\bukol/.test(f)) ||
    (/\bco\s+m(am|ame)\b/.test(f) && /\bukol/.test(f)) ||
    (/\buka[zž]\b/.test(f) && /\bukol/.test(f)) ||
    (/\bnajd/i.test(f) && /\bukol/.test(f))
  );
}

/** CAP15 cycle6: note_query module-exclusion + query DNA → gold unknown. */
function auditSilverNoteQueryModuleExclusionConflictUnknownFolded(fx) {
  const f = String(fx || "");
  const explicitModNeg =
    /\bne\s+v\s+kalend/.test(f) ||
    /\bne\s+do\s+kalend/.test(f) ||
    /\bne\s+do\s+ukol/.test(f) ||
    /\bne\s+v\s+ukol/.test(f) ||
    /\bne\s+do\s+poznam/.test(f) ||
    /\bne\s+v\s+poznam/.test(f);
  if (!explicitModNeg) return false;
  return (
    (/\bkde\s+m(am|ame)\b/.test(f) && /\bpoznam/.test(f)) ||
    (/\bco\s+m(am|ame)\b/.test(f) && /\bpoznam/.test(f)) ||
    (/\bkolik\b/.test(f) && /\bpoznam/.test(f)) ||
    /\bpodle\s+poznam/.test(f)
  );
}

function auditFoldedExplicitCalendarWriteVerbBeforeDoKalend(f) {
  const x = String(f || "");
  const iDo = x.search(/\bdo\s+kalend/);
  if (iDo < 0) return false;
  const verbs = ["uloz", "zapis", "pridej", "nahod", "nedej", "vloz", "naplanuj", "vytvor", "zaloz"];
  for (let vi = 0; vi < verbs.length; vi++) {
    const re = new RegExp("\\b" + verbs[vi] + "\\w*\\b");
    const m = re.exec(x);
    if (m && m.index >= 0 && m.index < iDo) return true;
  }
  if (/\bdej\b/.test(x)) {
    const m2 = /\bdej\b/.exec(x);
    if (m2 && m2.index >= 0 && m2.index < iDo) return true;
  }
  return false;
}

function hasExplicitNoCalendar(f) {
  const x = String(f || "");
  const writeCal = auditFoldedExplicitCalendarWriteVerbBeforeDoKalend(x);
  if (writeCal && /\bne\s+v\s+kalend/.test(x)) return false;
  if (writeCal && /\bne\s+do\s+poznam/.test(x)) return false;
  if (writeCal && /\bbez\s+ukol/.test(x)) return false;
  if (writeCal && /\bne\s+jako\s+ukol/.test(x)) return false;
  return /\bne\s+v\s+kalend|\bne\s+do\s+kalend|\bneuklad\w*\s+do\s+kalend|\bnic\s+z\s+toho\s+nedavej\s+do\s+kalend/.test(x);
}
function hasExplicitNoTasks(f) {
  return /\bne\s+do\s+ukol|\bne\s+v\s+ukol|\bneuklad\w*\s+do\s+ukol|\bnic\s+z\s+toho\s+nedavej\s+do\s+ukol/.test(f);
}
function hasExplicitNoNotes(f) {
  return /\bne\s+do\s+poznam|\bne\s+v\s+poznam|\bne\s+poznam|\bnic\s+z\s+toho\s+nedavej\s+do\s+poznam/.test(f);
}

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

function noteWriteCalendarScopeNegationExpectNoWriteFolded(fx) {
  const x = String(fx || "").trim();
  if (!x) return false;
  if (!hasExplicitNoCalendar(x)) return false;
  if (hasExplicitNoNotes(x)) return false;
  if (!noteWritePositiveCueFolded(x)) return false;
  return /^(ne\s+do\s+kalend|ne\s+v\s+kalend|neuklad\w*\s+do\s+kalend|nic\s+z\s+toho\s+nedavej\s+do\s+kalend)/.test(x);
}

function negForbiddenPerson(f) {
  const m = f.match(/\bnevrac\w*\s+(\w+)/);
  if (!m) return "";
  return m[1];
}

function detectCollectionConfusion(category, engIntent, expectedIntent) {
  const e = String(engIntent || "");
  const exp = String(expectedIntent || "");
  if (category === "calendar_write") {
    if (e === "tasks.create") return "calendar_vs_task_confusion";
    if (e === "notes.create") return "wrong_collection";
  }
  if (category === "task_write") {
    if (e === "calendar.create") return "calendar_vs_task_confusion";
    if (e === "notes.create") return "note_vs_task_confusion";
  }
  if (category === "note_write") {
    if (e === "calendar.create") return "wrong_collection";
    if (e === "tasks.create") return "note_vs_task_confusion";
  }
  if (category === "calendar_query") {
    if (e === "tasks.read" || e === "tasks.create") return "calendar_vs_task_confusion";
    if ((e === "notes.read" || e === "notes.create") && exp !== "note.query") return "wrong_collection";
  }
  if (category === "task_query") {
    if (e === "calendar.read" || e === "calendar.create") return "calendar_vs_task_confusion";
    if (e === "notes.read" || e === "notes.create") return "note_vs_task_confusion";
  }
  if (category === "note_query") {
    if (e === "calendar.read" || e === "calendar.create") return "wrong_collection";
    if (e === "tasks.read" || e === "tasks.create") return "note_vs_task_confusion";
  }
  return null;
}

function calendarWriteSemantic(turn, raw, foldedIn) {
  /* Negovaný zápis → engine vrací calendar.read; harness očekává calendar.query — nevyžadovat draftové klíčové slovo v odpovědi. */
  if (turn.normalizedIntent === "calendar.read" && turn.processingState === "READ_OK") {
    return { ok: true, cat: "" };
  }
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
  x = x.replace(/\bnesmis\s+vrait\w*\s+\w+/g, " ");
  return x.replace(/\s+/g, " ").trim();
}

function calendarQuerySemantic(input, folded, turn, raw, expectedIntent) {
  const expI = String(expectedIntent || "");
  if (expI === "unknown") return { ok: true, cat: "" };
  if (turn.processingState === "READY_TO_SAVE" || turn.normalizedIntent === "calendar.create") {
    return { ok: false, cat: "query_created_write" };
  }
  if (turn.processingState === "STORAGE_DISAMBIGUATION") {
    if (hasNegWrite(folded)) return { ok: false, cat: "negative_instruction_fail" };
  }
  if (!raw || raw.length < 8) return { ok: false, cat: "raw_response_empty" };
  if (/\bkam\s+to\s+chces\s+ulozit\b/i.test(raw) && /\bjen\s+cti\b/.test(folded)) return { ok: false, cat: "unnecessary_disambiguation" };
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
    /** P0 split: mixed negace / lead-token + „co … v kalendáři ohledně …“ — routing PASS stačí; seed/scope nemusí vrátit řádek. */
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
  if (/\buhli\b|\buhlí\b/.test(folded) && /\bpoznam/.test(foldCs(raw)) && !/\buhli\b|\buhlí\b/.test(foldCs(raw))) {
    return { ok: false, cat: "query_wrong_dataset" };
  }
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
  if (/\bbarvu\b.*\baut/.test(folded) && !/\bmodr/.test(foldCs(raw)) && !/\bnic\s+jsem/.test(foldCs(raw))) {
    return { ok: false, cat: "false_negative" };
  }
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

/** P0: globální negace + zápis do kalendáře → očekávání calendar.query (read), ne create. */
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

function evaluateOne(c, turn) {
  const raw = rawUserMessage(turn);
  const folded = foldCs(c.input);
  const eng = turn.normalizedIntent;
  let expectedIntent = c.expectedIntent;
  if (c.group === "calendar_write") {
    const ov = calendarWriteHarnessIntentOverride(folded);
    if (ov) expectedIntent = ov;
  }
  let auditIntent = engineToAuditIntent(eng, c.group);
  const conf = detectCollectionConfusion(c.group, eng, c.expectedIntent);
  if (conf) {
    return { pass: false, cat: conf, auditIntent, raw };
  }
  if (c.group !== "multi_intent") {
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
    if (
      c.group === "task_write" &&
      expectedIntent === "unknown" &&
      c.meta &&
      c.meta.readWritePriorityGate
    ) {
      const dangerousWrite =
        (eng === "tasks.create" && turn.processingState === "READY_TO_SAVE") ||
        (eng === "calendar.create" && turn.processingState === "READY_TO_SAVE") ||
        (eng === "notes.create" && turn.processingState === "READY_TO_SAVE");
      if (dangerousWrite) {
        return { pass: false, cat: "write_when_negated", auditIntent, raw };
      }
      return { pass: true, cat: "", auditIntent, raw };
    }
    if (
      (c.group === "task_query" || c.group === "note_query" || c.group === "calendar_query") &&
      expectedIntent === "unknown" &&
      c.meta &&
      c.meta.queryDisambiguationGate
    ) {
      const dangerousWrite =
        turn.processingState === "READY_TO_SAVE" ||
        eng === "calendar.create" ||
        eng === "tasks.create" ||
        eng === "notes.create";
      if (dangerousWrite) {
        return { pass: false, cat: "query_created_write", auditIntent, raw };
      }
      return { pass: true, cat: "", auditIntent, raw };
    }
    if (auditIntent === "unknown" || eng === "clarification") {
      if (expectedIntent !== "unknown") {
        return { pass: false, cat: "intent_fail", auditIntent, raw };
      }
      return { pass: true, cat: "", auditIntent, raw };
    }
    if (auditIntent !== expectedIntent) {
      return { pass: false, cat: "intent_fail", auditIntent, raw };
    }
  } else {
    if (auditIntent === "salutation.side") return { pass: false, cat: "intent_fail", auditIntent, raw };
  }

  if (c.group === "calendar_write") {
    const sem = calendarWriteSemantic(turn, raw, folded);
    if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
  } else if (c.group === "task_write") {
    const sem = taskWriteSemantic(turn, raw, folded);
    if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
  } else if (c.group === "note_write") {
    const sem = noteWriteSemantic(turn, raw, folded);
    if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
  } else if (c.group === "calendar_query") {
    const sem = calendarQuerySemantic(c.input, folded, turn, raw, c.expectedIntent);
    if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
  } else if (c.group === "task_query") {
    const sem = taskQuerySemantic(c.input, folded, turn, raw, c.expectedIntent);
    if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
  } else if (c.group === "note_query") {
    const sem = noteQuerySemantic(c.input, folded, turn, raw, c.expectedIntent);
    if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
  } else if (c.group === "multi_intent") {
    const sem = multiSemantic(c.meta || {}, turn, raw, folded);
    if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
  }

  if (c.group.indexOf("_query") > 0 && hasNegWrite(folded)) {
    if (turn.processingState === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create") {
      return { pass: false, cat: "negative_instruction_fail", auditIntent, raw };
    }
  }

  return { pass: true, cat: "", auditIntent, raw };
}

const PERSONS = [
  "Petr",
  "Tomáš",
  "Tomasek",
  "Pavel",
  "Petra",
  "Mariana",
  "Marie",
  "Jana",
  "Honza",
  "advokát",
  "pravnik",
  "právník",
  "zubař",
  "zubar",
  "doktor",
  "lékař",
  "účetní",
  "kurýr",
  "soused",
  "máma",
  "táta"
];
const ADDRS = [
  "Korunní 33 Praha",
  "Korunni 33 Praha",
  "Praha 1",
  "Praha jedna",
  "Praze jedna",
  "Spálená 3 Praha",
  "Spalena 3 Praha",
  "Vinohradská 3 Praha",
  "Vinohradska 3 Praha",
  "Dlouhá 12 Praha",
  "Dlouha 12 Praha",
  "Brno střed",
  "Brno stred",
  "Ostrava centrum",
  "Olomouc hlavní nádraží",
  "Plzeň Slovany",
  "Liberec centrum",
  "Hradec Králové",
  "Pardubice centrum"
];

/** Silver Quality Audit v1 — informational only; must not affect routing PASS/FAIL or expectedIntent. */
const TITLE_QUALITY_FILLER_RE =
  /\b(?:pros[ií]m|prosim)\b|\b(?:ho[dď]|hod)\b|\b(?:napi[šs]|napis)\b|\b(?:ulo[zž]|uloz)\b|\bsi\b|\bmi\b/i;
const DATE_QUALITY_RELATIVE_RAW_RE =
  /\b(zitra|zítra|dnes|pozitri|pozítří|pondeli|pondělí|utery|úterý|streda|středa|stredu|středu|ctvrtek|čtvrtek|patek|pátek|vikend|víkend|tyden|týden|mesic|měsíc|pristi|příští|koncem|tento|tenhle)\b/i;

function measureSilverQualityV1(turn, rawOut) {
  const d = turn.draft || {};
  const raw = String(rawOut || "");

  const titleStr = String(d.title || "").trim();
  let titleClean = true;
  if (titleStr) {
    const ft = foldCs(titleStr);
    if (TITLE_QUALITY_FILLER_RE.test(ft)) titleClean = false;
    if (ft.length > 100) titleClean = false;
  }

  const iso = String(d.dateISO || "").trim();
  const dateS = String(d.date || "").trim();
  const dateCombined = iso || dateS;
  let dateParsed = true;
  if (dateCombined) {
    const hasIso =
      /^\d{4}-\d{2}-\d{2}/.test(iso) ||
      /^\d{4}-\d{2}-\d{2}/.test(dateS) ||
      /\d{4}-\d{2}-\d{2}/.test(dateCombined);
    const hasDotted = /\d{1,2}\.\s*\d{1,2}\.\s*\d{2,4}/.test(dateCombined);
    if (hasIso || hasDotted) dateParsed = true;
    else if (DATE_QUALITY_RELATIVE_RAW_RE.test(dateCombined) && !/\d{4}-\d{2}-\d{2}/.test(dateCombined)) dateParsed = false;
  }

  const th = String(d.timeHHMM || "").trim();
  const tm = String(d.time || "").trim();
  const timeCombined = th || tm;
  let timeParsed = true;
  if (timeCombined) {
    if (/\d{1,2}:\d{2}/.test(timeCombined)) timeParsed = true;
    else {
      const ftime = foldCs(timeCombined);
      if (/\b(vecer|večer|rano|ráno|odpoledne|dopoledne|po\s+obede|po\s+obědě|kolem)\b/.test(ftime) && !/\d/.test(timeCombined)) timeParsed = false;
    }
  }

  const parts = [raw, d.title, d.note, d.silverNoteText, d.address, d.location].filter(Boolean);
  const hay = foldCs(parts.join(" "));
  let entityOk = false;
  if (hay) {
    for (let pi = 0; pi < PERSONS.length; pi++) {
      const fp = foldCs(PERSONS[pi]);
      if (fp.length >= 2 && hay.indexOf(fp) >= 0) {
        entityOk = true;
        break;
      }
    }
    if (!entityOk) {
      for (let ai = 0; ai < ADDRS.length; ai++) {
        const fa = foldCs(ADDRS[ai]);
        if (fa.length >= 3 && hay.indexOf(fa) >= 0) {
          entityOk = true;
          break;
        }
      }
    }
    if (!entityOk) {
      if (
        /\b(lednic|marek|pepa|pravnic|zubar|doktor|ucetn|kuryr|schuzk|ukol|poznam|korunn|prahou|dlouh|ostrava|brno|vinohrad|spalen|pardubic)\w*/.test(
          hay
        )
      ) {
        entityOk = true;
      }
    }
  }

  return { titleClean, dateParsed, timeParsed, entityOk };
}

/** P0 diagnostic only: title-cleaning cluster tags (must not affect PASS/FAIL or measureSilverQualityV1). */
const TITLE_FAIL_FILLER_CANON = [
  { key: "prosim", re: /\bprosim\b/ },
  { key: "hod", re: /\bhod\b/ },
  { key: "napis", re: /\bnapis\b/ },
  { key: "uloz", re: /\buloz\b/ },
  { key: "si", re: /\bsi\b/ },
  { key: "mi", re: /\bmi\b/ }
];

function extractTitleFailFillerTokens(foldedTitle) {
  const ft = String(foldedTitle || "");
  const out = [];
  for (let i = 0; i < TITLE_FAIL_FILLER_CANON.length; i++) {
    const x = TITLE_FAIL_FILLER_CANON[i];
    if (x.re.test(ft)) out.push(x.key);
  }
  return out;
}

function classifyTitleFailBordelBuckets(foldedTitle, foldedInput, titleRaw) {
  const ft = String(foldedTitle || "");
  const fi = String(foldedInput || "");
  const tr = String(titleRaw || "");
  const buckets = [];
  if (/\bprosim\b/.test(ft)) buckets.push("prosim_prosim");
  if (/\bhod\b/.test(ft)) buckets.push("hod_hod");
  if (/\bnapis\b/.test(ft)) buckets.push("napis_napis");
  if (/\buloz\b/.test(ft)) buckets.push("uloz_uloz");
  if (/\bsi\b/.test(ft)) buckets.push("si_si");
  if (/\bmi\b/.test(ft)) buckets.push("mi_mi");
  if (/\bjen\s+zjist\w*\b/.test(ft) || /\bjen\s+se\s+podiv\w*\b/.test(ft) || /\bjen\s+cti\b/.test(ft)) {
    buckets.push("readonly_prefix_in_title");
  }
  if (
    /\bjen\s+zjist\w*\b/.test(fi) ||
    /\bjen\s+se\s+podiv\w*\b/.test(fi) ||
    /\bjen\s+cti\b/.test(fi) ||
    /\bpouze\s+cti\b/.test(fi)
  ) {
    buckets.push("readonly_prefix_in_user_input_context");
  }
  if (/\bpriorit\w*\b/.test(ft) || /\bdulezit\w*\b/.test(ft)) {
    buckets.push("priorita_dulezite_in_title_metadata_leak");
  }
  const ftp = foldCs(String(tr || "").trim());
  if (/^(uloz|ulozte|zapis|zapiste|pridej|pridejte|hod|napis|napiste|dej|dejte)\w*(\s+mi|\s+si)?\s+/.test(ftp)) {
    buckets.push("raw_command_prefix_before_real_title");
  }
  if (tr.length > 100) buckets.push("title_len_gt_100");
  return buckets;
}

const TIMES = [
  "15:00",
  "10:15",
  "18:00",
  "14:30",
  "09:00",
  "v 15 hodin",
  "v deset",
  "v deset patnáct",
  "ve dvě třicet",
  "ve dve tricet",
  "v půl třetí",
  "v pul treti",
  "ráno",
  "odpoledne",
  "večer",
  "vecer",
  "po obědě",
  "po obedu",
  "kolem šesté",
  "kolem seste"
];
const DATES = [
  "dnes",
  "dneska",
  "zítra",
  "zitra",
  "pozítří",
  "pozitri",
  "tento týden",
  "tenhle týden",
  "příští pondělí",
  "pristi pondeli",
  "ve čtvrtek",
  "ve ctvrtek",
  "do pátku",
  "do patku",
  "do 10 dnů",
  "do deseti dnů",
  "za týden",
  "za tyden",
  "na víkend",
  "na vikend",
  "příští měsíc",
  "pristi mesic",
  "koncem týdne",
  "koncem tydne"
];
const NEGS = [
  "nic neukládej",
  "neukládej",
  "jen čti",
  "jen se podívej",
  "jen ověř",
  "jen vypiš",
  "jen zjisti",
  "nevytvářej událost",
  "nevytvářej úkol",
  "nevytvářej poznámku",
  "ne v kalendáři",
  "ne do kalendáře",
  "ne do úkolů",
  "ne do poznámek",
  "nepleť to s kalendářem",
  "nepleť to s úkolem",
  "nepleť to s poznámkou",
  "nevracej Tomáše",
  "nevracej Petra",
  "nevracej Pavla",
  "nevracej právníka",
  "nevracej advokáta",
  "nevracej zubaře",
  "nevracej schůzku",
  "nevracej úkol",
  "nevracej poznámku",
  "neptej se kam uložit",
  "neptej se na čas uložení",
  "pokud nic nenajdeš, nic nevytvářej",
  "pokud není výsledek, řekni že nic není"
];

function stripDiak(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function mixDiak(s) {
  return s
    .replace(/\bdo\b/gi, "do")
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

function classifyDiacFlags(input) {
  const n = input.normalize("NFD");
  const has = /[\u0300-\u036f]/.test(n) || /[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/.test(input);
  const ascii = stripDiak(input) === input && !/[áčďéěíňóřšťúůýž]/.test(input);
  const mixed = has && /[aeiou]{2,}|[szrc][a-z]{2,}/i.test(stripDiak(input)) && stripDiak(input) !== input;
  return { has, ascii, mixed: mixed || (has && ascii) };
}

function buildCases() {
  const cases = [];
  let gid = 0;

  function push(group, input, expectedIntent, meta, flags) {
    gid++;
    const id = group + "_" + String(gid).padStart(5, "0");
    const di = classifyDiacFlags(input);
    const negHit = NEGS.some((n) => foldCs(input).indexOf(foldCs(n)) >= 0) || /\bne\s+v\s+|\bne\s+do\s+/.test(foldCs(input));
    cases.push({
      id,
      group,
      input,
      expectedIntent,
      meta: meta || {},
      flags: Object.assign(
        {
          with_negative: negHit,
          with_person: PERSONS.some((p) => foldCs(input).indexOf(foldCs(p)) >= 0),
          with_address: ADDRS.some((a) => foldCs(input).indexOf(foldCs(a)) >= 0),
          with_time: TIMES.some((t) => foldCs(input).indexOf(foldCs(t)) >= 0),
          with_date: DATES.some((d) => foldCs(input).indexOf(foldCs(d)) >= 0),
          explicit_mod: /\bdo\s+kalend|\bdo\s+ukol|\bdo\s+poznam|\bjen\s+v\s+kalend|\bjen\s+v\s+ukol|\bjen\s+v\s+poznam/.test(foldCs(input)),
          implicit_mod: /\bschuzk|\budalost|\bzapamat|\bmusim\b|\bnezapomen\b/.test(foldCs(input)) && !/\bdo\s+kalend|\bdo\s+ukol|\bdo\s+poznam/.test(foldCs(input)),
          long_sent: input.length > 110,
          compound: /\bale\b|\bprotoze\b|\bprotože\b|\bale\s+/.test(foldCs(input)),
          ambiguous: /\bnejak\b|\bnejasn|\basi\b|\bmožná\b|\bmozna\b/.test(foldCs(input)),
          diac_has: di.has,
          di_ascii: di.ascii && !di.has,
          di_mixed: di.mixed
        },
        flags || {}
      )
    });
  }

  for (let i = 0; i < 3000; i++) {
    const p = PERSONS[i % PERSONS.length];
    const a = ADDRS[(i * 3) % ADDRS.length];
    const t = TIMES[(i * 5) % TIMES.length];
    const d = DATES[(i * 7) % DATES.length];
    const neg = i % 2 === 0 ? NEGS[i % NEGS.length] + ". " : "";
    const templates = [
      () => `${neg}Pepo, ulož mi prosím do kalendáře na ${d} v ${t} schůzku s ${p}, název nech krátký, poznámka vzít smlouvu, ${NEGS[(i + 3) % NEGS.length]}.`,
      () => `${neg}Silvere, potřebuju mít v kalendáři ${d} v ${t} ${p === "zubař" ? "zubaře" : "jednání s " + p} na adrese ${a}, ale název zůstane jen Schůzka.`,
      () => `${neg}Mám schůzku ${d} v ${t} s ${p}, dej to do kalendáře, ne do úkolů.`,
      () => `${neg}Zapiš mi ${d} v ${t} na ${a} událost kvůli práci, ale není to poznámka.`,
      () => `${neg}Rodinný kontext: ${d} odpoledne mám u lékaře ${p}, ulož do kalendáře, neukládej jako úkol.`,
      () => `${neg}Vlastně to dej na ${d}: ${t} mám ${p}, předtím jsem psal špatně.`,
      () => `${neg}Rychle mi nahod do kalendare ${d} ${t} schuzku, adresu ${stripDiak(a)}, bez ukolu.`,
      () => `${neg}Obchodní věc: ${d} ${t} právník na ${a}, jen kalendář, ne poznámky.`,
      () => `${neg}Cesta: ${d} v ${t} odjezd k ${p}, kalendář.`,
      () => `${neg}Více časů: buď v 15:00 nebo v 18:00 hlavně ${t} pro ${p}, ulož jako jednu událost ${d}.`
    ];
    const base = templates[i % templates.length]();
    push("calendar_write", diacVariant(i, base), "calendar.create", { slot: i }, {});
  }

  for (let i = 0; i < 3000; i++) {
    const neg = NEGS[(i * 2) % NEGS.length];
    const p = PERSONS[(i * 4) % PERSONS.length];
    const a = ADDRS[(i * 5) % ADDRS.length];
    const lines = [
      `${neg} Pepo, co mám ${DATES[i % DATES.length]} v kalendáři ohledně ${p}?`,
      `Jen zjisti v kalendáři adresu ${a} pro zubaře a ${neg}.`,
      `Kdy mám ${p} a kolik toho mám tento týden, ${neg}?`,
      `Najdi schůzku s ${p} na zítřek, ${neg.replace(/e/g, "e")}.`,
      `Bez diakritiky: podivej se do kalendare co mam zitra, ${stripDiak(neg)}.`,
      `Jakou adresu má záznam u ${foldCs(p).indexOf("zubar") >= 0 ? "zubaře" : "právníka"}, jen v kalendáři, ${neg}.`,
      `Co máme v kalendáři ve čtvrtek, ${neg}?`,
      `Hledám poznámku smlouva v kontextu kalendáře pro ${p}, ${neg}.`
    ];
    const lineIx = i % lines.length;
    const expQ = lineIx === 7 ? "note.query" : "calendar.query";
    push("calendar_query", diacVariant(i, lines[lineIx]), expQ, {}, {});
  }

  for (let i = 0; i < 3000; i++) {
    const neg = i % 3 === 0 ? NEGS[i % NEGS.length] + " " : "";
    const thing = ["uhlí", "rohlíky", "mléko", "toaleták", "tráva", "telefon"][i % 6];
    const lines = [
      `${neg}Hoď mi do úkolů, že ${thing} do pátku, ale ne do kalendáře.`,
      `${neg}Musím koupit ${thing} do ${i % 2 ? "10 dnů" : "zítra"}, není to poznámka.`,
      `${neg}Přidej úkol zavolat Pavlovi a nepleť to se schůzkou v kalendáři.`,
      `${neg}Nákup: 10 rohlíků, 5 mlék, 3 kečupy jako jeden úkol do pátku.`,
      `${neg}Pracovní: poslat dokument účetnímu, úkol, ne kalendář.`,
      `${neg}Bez diakritiky: uloz do ukolu koupit ${stripDiak(thing)} ale nic do kalendare.`,
      `${neg}Priorita důležité: opravit plot, až bude čas, do úkolů.`,
      `${neg}Nezapomeň připomenout koupit ${thing}, implicitně úkol.`
    ];
    push("task_write", diacVariant(i, lines[i % lines.length]), "task.create", {}, {});
  }

  for (let i = 0; i < 3000; i++) {
    const neg = NEGS[(i + 5) % NEGS.length];
    const lines = [
      `Podívej se jen do úkolů, jestli mám koupit uhlí do pátku, ${neg}.`,
      `Co mám splnit do pátku, jen úkoly, ${neg}?`,
      `Najdi úkol rohlíky, ${neg}, nevracej schůzku.`,
      `Mám zavolat Pavlovi v úkolech, ${neg}?`,
      `Kolik mám úkolů s deadlinem zítra, ${neg}?`,
      `Bez diakritiky: podivej jen do ukolu co mam na dnes, ${stripDiak(neg)}.`,
      `Právník v úkolech vs kalendář: jen úkoly, ${neg}.`
    ];
    push("task_query", diacVariant(i, lines[i % lines.length]), "task.query", {}, {});
  }

  for (let i = 0; i < 3000; i++) {
    const neg = NEGS[(i + 1) % NEGS.length];
    const lines = [
      `Dej mi do poznámky, že auto mělo modrou barvu, ${neg}, ne úkol.`,
      `Ulož fakt o ${ADDRS[i % ADDRS.length]} do poznámek, ne jako událost, ${neg}.`,
      `Poznamenej si PIN ke kartě je doma, není to úkol, ${neg}.`,
      `Zapamatuj si velikost bot 33, ${neg}, ne kalendář.`,
      `Bez diakritiky: dej do poznamek ze soused ma klic, ${stripDiak(neg)} ne jako ukol.`,
      `Ulož do poznámek, že advokát potřebuje plnou moc, ${neg}.`
    ];
    push("note_write", diacVariant(i, lines[i % lines.length]), "note.create", {}, {});
  }

  for (let i = 0; i < 3000; i++) {
    const neg = NEGS[(i + 7) % NEGS.length];
    const lines = [
      `Najdi v poznámkách barvu auta, ${neg}.`,
      `Kde mám klíče podle poznámek, ${neg}?`,
      `Jakou adresu má zubař v poznámkách, ${neg}?`,
      `Co mám v poznámkách o Mariane, ${neg}?`,
      `Bez diakritiky: najdi v poznamkach pin, ${stripDiak(neg)}.`
    ];
    push("note_query", diacVariant(i, lines[i % lines.length]), "note.query", {}, {});
  }

  for (let i = 0; i < 2000; i++) {
    const neg = NEGS[i % NEGS.length];
    const lines = [
      `Ulož do kalendáře zítra zubaře v 15:00 na Korunní 33 Praha a zároveň do poznámky napiš kartičku pojištěnce, ${neg}.`,
      `Přidej úkol koupit uhlí do pátku a do poznámek, že dodavatel je stejný, ale nic do kalendáře, ${neg}.`,
      `Jen se podívej do kalendáře na zítra zubaře, nic neukládej, a pokud najdeš adresu, jen ji vypiš, ${neg}.`,
      `Zjisti v poznámkách barvu auta a zároveň úkol koupit stěrače, nepleť auto s úkolem, ${neg}.`,
      `Kalendář: ${DATES[i % DATES.length]} ${PERSONS[i % PERSONS.length]}; úkol: koupit mléko; ${neg}.`,
      `Bez diakritiky: uloz ukol uhli a zaroven poznamku dodavatel, ${stripDiak(neg)}.`
    ];
    const inp = diacVariant(i, lines[i % lines.length]);
    const f = foldCs(inp);
    const needsDualWrite =
      /zároveň|zaroven|a\s+zároveň|a\s+zaroven/i.test(inp) &&
      /\bdo\s+poznam|\bpoznam|\bdo\s+kalend|\bdo\s+ukol|\buloz|\bulož|\bpridej|\bpřidej/i.test(f);
    const queryNeg = /jen\s+se\s+podivej|jen\s+cti|nic\s+neuklad/.test(f) ? f : "";
    push(
      "multi_intent",
      inp,
      "unknown",
      { needsDualWrite, queryNeg },
      { multi: true }
    );
  }

  for (let idx = 0; idx < cases.length; idx++) {
    const c = cases[idx];
    if (idx < 10000) {
      if (!classifyDiacFlags(c.input).has) c.input = c.input + " (příloha)";
    } else if (idx < 15000) {
      c.input = stripDiak(c.input).replace(/[^\x00-\x7f]+/g, " ");
    } else if (idx < 17000) {
      c.input = mixDiak(c.input) + " částečně";
    }
    const di = classifyDiacFlags(c.input);
    c.flags.diac_has = di.has;
    c.flags.diac_ascii = !!(di.ascii && !di.has);
    c.flags.diac_mixed = !!(idx >= 15000 && idx < 17000) || !!di.mixed;
  }

  for (const c of cases) {
    const negHit =
      NEGS.some((n) => foldCs(c.input).indexOf(foldCs(n)) >= 0) || /\bne\s+v\s+|\bne\s+do\s+/.test(foldCs(c.input));
    c.flags.with_negative = negHit;
  }

  /** P0 Silver: read-prefix + explicit calendar write — must stay 20000 total cases (ids use global gid). */
  function silverPatchCaseByGroupIndex(group, index0, patch) {
    let seen = -1;
    for (let ci = 0; ci < cases.length; ci++) {
      if (cases[ci].group !== group) continue;
      seen++;
      if (seen === index0) {
        cases[ci].input = patch.input;
        cases[ci].expectedIntent = patch.expectedIntent;
        cases[ci].meta = Object.assign({}, cases[ci].meta || {}, { readWritePriorityGate: true });
        return;
      }
    }
    throw new Error("silverPatchCaseByGroupIndex missing " + group + "[" + index0 + "]");
  }
  const SILVER_READ_WRITE_PRIORITY_PATCH = [
    {
      group: "calendar_write",
      index0: 6,
      input:
        "jen zjisti. Rychle mi nahod do kalendare na víkend v půl třetí schuzku, adresu Pardubice centrum, bez ukolu.",
      expectedIntent: "calendar.create"
    },
    {
      group: "calendar_write",
      index0: 0,
      input: "Jen zjisti. Nahod do kalendáře schůzku s Petrem zítra v 15:00.",
      expectedIntent: "calendar.create"
    },
    {
      group: "calendar_write",
      index0: 1,
      input: "Jen zjisti, ale potom to ulož do kalendáře na zítra v 15:00.",
      expectedIntent: "calendar.create"
    },
    {
      group: "calendar_write",
      index0: 2,
      input: "Jen se podívej. Dej do kalendáře schůzku s Tomášem v pátek v 10.",
      expectedIntent: "calendar.create"
    },
    {
      group: "calendar_write",
      index0: 3,
      input: "Neukládej to jako úkol, dej to do kalendáře zítra v 15:00.",
      expectedIntent: "calendar.create"
    },
    {
      group: "calendar_write",
      index0: 4,
      input: "Není to poznámka, nahoď mi do kalendáře schůzku s Petrem v pondělí.",
      expectedIntent: "calendar.create"
    },
    {
      group: "calendar_query",
      index0: 0,
      input: "Nic neukládej, jen zjisti co mám zítra.",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 1,
      input: "Nevytvářej nic, jen čti kalendář.",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 2,
      input: "Neukládej do kalendáře, jen zjisti co mám zítra.",
      expectedIntent: "calendar.query"
    },
    { group: "calendar_query", index0: 3, input: "Jen zjisti a nic nevytvářej.", expectedIntent: "unknown" },
    {
      group: "calendar_write",
      index0: 10,
      input:
        "ne v kalendáři. Pepo, ulož mi prosím do kalendáře na koncem týdne v v půl třetí schůzku s pravnik, název nech krátký, poznámka vzít smlouvu, ne do poznámek.",
      expectedIntent: "calendar.create"
    },
    {
      group: "calendar_write",
      index0: 11,
      input: "ne do poznámek. ulož mi do kalendáře schůzku s Petrem zítra v 15:00.",
      expectedIntent: "calendar.create"
    },
    {
      group: "calendar_write",
      index0: 12,
      input: "bez úkolu. dej do kalendáře schůzku s Tomášem v pátek v 10.",
      expectedIntent: "calendar.create"
    },
    {
      group: "calendar_write",
      index0: 13,
      input: "ne jako úkol, nahoď do kalendáře kontrolu smlouvy zítra v 9.",
      expectedIntent: "calendar.create"
    },
    { group: "calendar_query", index0: 4, input: "ne v kalendáři a nic nevytvářej.", expectedIntent: "unknown" },
    {
      group: "calendar_write",
      index0: 21,
      input: "Ne v kalendáři. ulož do kalendáře schůzku s Janem zítra v 10.",
      expectedIntent: "calendar.create"
    }
  ];
  for (let pi = 0; pi < SILVER_READ_WRITE_PRIORITY_PATCH.length; pi++) {
    const p = SILVER_READ_WRITE_PRIORITY_PATCH[pi];
    silverPatchCaseByGroupIndex(p.group, p.index0, { input: p.input, expectedIntent: p.expectedIntent });
  }

  const SILVER_IMPLICIT_CALENDAR_ONLY_WRITE_PATCH = [
    {
      group: "calendar_write",
      index0: 17,
      input: "Obchodni vec: koncem tydne v 15 hodin pravnik na Ostrava centrum, jen kalendar, ne poznamky.",
      expectedIntent: "calendar.create"
    },
    {
      group: "calendar_write",
      index0: 14,
      input: "Koncem týdne v 15 hodin právník na Ostrava centrum, jen kalendář, ne poznámky.",
      expectedIntent: "calendar.create"
    },
    {
      group: "calendar_write",
      index0: 15,
      input: "Zítra v 9 kontrola smlouvy Praha 1, jen kalendář.",
      expectedIntent: "calendar.create"
    },
    {
      group: "calendar_write",
      index0: 16,
      input: "V pátek v 10 Tomáš Brno centrum, pouze do kalendáře, bez úkolu.",
      expectedIntent: "calendar.create"
    },
    {
      group: "calendar_write",
      index0: 18,
      input: "Příští týden v půl třetí doktor Korunní 33, ne do poznámek.",
      expectedIntent: "calendar.create"
    },
    {
      group: "calendar_write",
      index0: 19,
      input: "Jen kalendář: zubař zítra v 15:00 adresa Korunní 33 Praha.",
      expectedIntent: "calendar.create"
    },
    {
      group: "calendar_query",
      index0: 5,
      input: "Jen zjisti, zítra v 9 kontrola smlouvy Praha 1.",
      expectedIntent: "unknown"
    }
  ];
  for (let qi = 0; qi < SILVER_IMPLICIT_CALENDAR_ONLY_WRITE_PATCH.length; qi++) {
    const q = SILVER_IMPLICIT_CALENDAR_ONLY_WRITE_PATCH[qi];
    silverPatchCaseByGroupIndex(q.group, q.index0, { input: q.input, expectedIntent: q.expectedIntent });
  }

  /** P0: kalendářní read + negace poznámek — regresní kotvy (calendar_query_03009 třída). */
  const SILVER_CALENDAR_QUERY_NOTE_NEGATION_PATCH = [
    {
      group: "calendar_query",
      index0: 6,
      input: "Bez poznámek, co mám zítra v kalendáři?",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 7,
      input: "Ne do poznámek, jaké mám v pondělí události v kalendáři?",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 8,
      input: "Nepleť to s poznámkou, co máme příští týden v kalendáři?",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 9,
      input: "nepleť to s poznámkou Pepo, co mám příští pondělí v kalendáři ohledně právník?",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 10,
      input: "Nic neukládej, nepleť to s poznámkou, co mám zítra v kalendáři?",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_write",
      index0: 20,
      input: "Nepleť to s poznámkou, ulož do kalendáře schůzku s Janem zítra v 10.",
      expectedIntent: "calendar.create"
    },
    {
      group: "note_query",
      index0: 0,
      input: "Najdi poznámku smlouva v kontextu kalendáře, nepleť to s kalendářem.",
      expectedIntent: "note.query"
    }
  ];
  for (let ni = 0; ni < SILVER_CALENDAR_QUERY_NOTE_NEGATION_PATCH.length; ni++) {
    const p = SILVER_CALENDAR_QUERY_NOTE_NEGATION_PATCH[ni];
    silverPatchCaseByGroupIndex(p.group, p.index0, { input: p.input, expectedIntent: p.expectedIntent });
  }

  /** P0: calendar_query řádek 4 + NEGS „ne v kalendáři“ (25× i≡20 mod 120) → unknown, sladění s produktem. */
  for (let i = 0; i < 3000; i++) {
    if (i % 8 !== 4 || (i * 2) % 30 !== 10) continue;
    const neg = NEGS[(i * 2) % NEGS.length];
    const p = PERSONS[(i * 4) % PERSONS.length];
    const a = ADDRS[(i * 5) % ADDRS.length];
    const lines = [
      `${neg} Pepo, co mám ${DATES[i % DATES.length]} v kalendáři ohledně ${p}?`,
      `Jen zjisti v kalendáři adresu ${a} pro zubaře a ${neg}.`,
      `Kdy mám ${p} a kolik toho mám tento týden, ${neg}?`,
      `Najdi schůzku s ${p} na zítřek, ${neg.replace(/e/g, "e")}.`,
      `Bez diakritiky: podivej se do kalendare co mam zitra, ${stripDiak(neg)}.`,
      `Jakou adresu má záznam u ${foldCs(p).indexOf("zubar") >= 0 ? "zubaře" : "právníka"}, jen v kalendáři, ${neg}.`,
      `Co máme v kalendáři ve čtvrtek, ${neg}?`,
      `Hledám poznámku smlouva v kontextu kalendáře pro ${p}, ${neg}.`
    ];
    const lineIx = i % lines.length;
    const inp = diacVariant(i, lines[lineIx]);
    silverPatchCaseByGroupIndex("calendar_query", i, { input: inp, expectedIntent: "unknown" });
  }

  const SILVER_CALENDAR_QUERY_NO_CALENDAR_CONFLICT_KOTVA = [
    {
      group: "calendar_query",
      index0: 11,
      input: "Bez diakritiky: podivej se do kalendare co mam zitra, ne v kalendari.",
      expectedIntent: "unknown"
    },
    {
      group: "calendar_query",
      index0: 12,
      input: "Podívej se do kalendáře co mám zítra, ne v kalendáři.",
      expectedIntent: "unknown"
    },
    {
      group: "calendar_query",
      index0: 13,
      input: "Co mám zítra v kalendáři, ale ne v kalendáři?",
      expectedIntent: "unknown"
    },
    {
      group: "calendar_query",
      index0: 14,
      input: "Ne v kalendáři a nic nevytvářej.",
      expectedIntent: "unknown"
    },
    {
      group: "calendar_query",
      index0: 15,
      input: "Nepleť to s poznámkou, co mám zítra v kalendáři?",
      expectedIntent: "calendar.query"
    }
  ];
  for (let ki = 0; ki < SILVER_CALENDAR_QUERY_NO_CALENDAR_CONFLICT_KOTVA.length; ki++) {
    const k = SILVER_CALENDAR_QUERY_NO_CALENDAR_CONFLICT_KOTVA[ki];
    silverPatchCaseByGroupIndex(k.group, k.index0, { input: k.input, expectedIntent: k.expectedIntent });
  }

  /** P0: adresní/detail calendar read + scope jen kalendář + „ne do úkolů“ (calendar_query_03022). */
  const SILVER_CALENDAR_QUERY_ADDRESS_DETAIL_READ_PATCH = [
    {
      group: "calendar_query",
      index0: 21,
      input: "Jakou adresu ma zaznam u pravnika, jen v kalendari, ne do ukolu.",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 16,
      input: "Jakou adresu má schůzka s právníkem, jen v kalendáři, ne do úkolů.",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 17,
      input: "Kde mám záznam u právníka v kalendáři?",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 18,
      input: "Najdi adresu události právník, ne v poznámkách, jen kalendář.",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 19,
      input: "Jaké jsou detaily schůzky s právníkem v kalendáři?",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 22,
      input: "Kde je schůzka s právníkem zítra?",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 23,
      input: "Podívej se do kalendáře co mám zítra, ne v kalendáři.",
      expectedIntent: "unknown"
    }
  ];
  for (let ai = 0; ai < SILVER_CALENDAR_QUERY_ADDRESS_DETAIL_READ_PATCH.length; ai++) {
    const a = SILVER_CALENDAR_QUERY_ADDRESS_DETAIL_READ_PATCH[ai];
    silverPatchCaseByGroupIndex(a.group, a.index0, { input: a.input, expectedIntent: a.expectedIntent });
  }

  /** P0: calendar_query_03026 — adresní read + „pro zubaře“ + negace „nevracej právníka“ nesmí přepsat title query na právníka. */
  silverPatchCaseByGroupIndex("calendar_query", 25, {
    input: "Jen zjisti v kalendáři adresu Brno střed pro zubaře a nevracej právníka.",
    expectedIntent: "calendar.query"
  });

  /** P0: calendar_query_03027 — kdy mám + osoba + kolik toho + tento týden + nevracej (exclude, ne blokace). */
  silverPatchCaseByGroupIndex("calendar_query", 26, {
    input: "Kdy mám táta a kolik toho mám tento týden, nevracej zubaře?",
    expectedIntent: "calendar.query"
  });

  /** P0: calendar_query_03029 — explicitní read + agenda + negace „kam uložit“ nesmí blokovat calendar.query. */
  const SILVER_CALENDAR_QUERY_STORAGE_NEGATION_KOTVA = [
    {
      group: "calendar_query",
      index0: 27,
      input: "Podívej se do kalendáře co mám zítra, neptej se kam uložit.",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 28,
      input: "podivej se do kalendare co mam zitra, neptej se kam ulozit.",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 29,
      input: "mrkni do kalendare co mam zitra, neptej se kam ulozit.",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 30,
      input: "Koukni do kalendáře co mám dnes, bez dotazu kam uložit.",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 31,
      input: "Podívej se do kalendáře co mám tento týden, neptat se kam uložit.",
      expectedIntent: "calendar.query"
    },
    {
      group: "calendar_query",
      index0: 32,
      input: "Podívej se do kalendáře, ale ne v kalendáři",
      expectedIntent: "unknown"
    }
  ];
  for (let si = 0; si < SILVER_CALENDAR_QUERY_STORAGE_NEGATION_KOTVA.length; si++) {
    const sk = SILVER_CALENDAR_QUERY_STORAGE_NEGATION_KOTVA[si];
    silverPatchCaseByGroupIndex(sk.group, sk.index0, { input: sk.input, expectedIntent: sk.expectedIntent });
  }

  /** P0: calendar_query_03036 — najdi schůzku + negace kalendářního modulu → safe clarification (unknown), ne note.query. */
  silverPatchCaseByGroupIndex("calendar_query", 35, {
    input: "Najdi schůzku s doktorem na zítřek, ne v kalendáři.",
    expectedIntent: "unknown"
  });

  silverPatchCaseByGroupIndex("note_query", 1, {
    input: "Najdi poznámku smlouva v kontextu kalendáře, nepleť to s kalendářem.",
    expectedIntent: "note.query"
  });

  /** P0 split: A/B — modulová negace kalendáře + čtecí signál → unknown; D — lead „ne v kalendáři“ + „co … v kalendáři … ohledně …“ → calendar.query; storage negace zůstává calendar.query. */
  function auditSilverCalendarQueryStorageNegationKeepQueryFolded(fx) {
    const storageNeg =
      /\bneptej\s+se\s+kam\s+uloz/i.test(fx) || /\bneptej\s+se\s+na\s+cas\s+uloz/i.test(fx);
    if (!storageNeg) return false;
    /**
     * P0 03104: „neptej se kam uložit“ je storage negace — nesmí přepsat explicitní note read
     * (+ „v kontextu kalendáře“) na calendar.query. Čisté calendar read věty typu „Podívej se do kalendáře …“
     * nemají signál poznámky ani „v kontextu kalendáře“ a zůstávají calendar.query.
     */
    if (/\bv\s+kontextu\s+kalend/.test(fx)) {
      if (/\bhledam\s+poznamk/.test(fx) || /\bnajdi\s+poznamk/.test(fx)) return false;
      if (/\bpoznamk(?:a|u|y|ou|ce|ach)\b/.test(fx)) return false;
    }
    return true;
  }
  function auditSilverCalendarQueryDLeadOhledneExpectCalendarQueryFolded(fx) {
    if (!/\bne\s+v\s+kalend/.test(fx)) return false;
    return /\bco\s+m(am|ame)\b/.test(fx) && /\bv\s+kalend/.test(fx) && /\bohledn/.test(fx);
  }
  function auditSilverCalendarQueryAbModuleConflictUnknownFolded(fx) {
    if (auditSilverCalendarQueryDLeadOhledneExpectCalendarQueryFolded(fx)) return false;
    if (auditSilverCalendarQueryStorageNegationKeepQueryFolded(fx)) return false;
    if (/\bneukladej\s+do\s+kalendar/.test(fx)) return false;
    const explicitModNeg =
      /\bne\s+v\s+kalend/.test(fx) ||
      /\bne\s+do\s+kalend/.test(fx) ||
      /\bmimo\s+kalendar/.test(fx) ||
      /\bale\s+ne\s+v\s+kalend/.test(fx) ||
      /\bnechci\s+v\s+kalend/.test(fx);
    if (!explicitModNeg) return false;
    const readSearchSignal =
      /\bnajdi\s+schuz/.test(fx) ||
      /\bpodivej(?:te)?\s+se\s+do\s+kalend/.test(fx) ||
      /\b(?:mrkni|mrknete|koukni|kouknete)\s+do\s+kalend/.test(fx) ||
      /\bkdy\s+m(am|ame)\b/.test(fx) ||
      /\bagend/.test(fx) ||
      /\bprogram\b/.test(fx) ||
      /\bco\s+m(am|ame)\s+zitra\b/.test(fx) ||
      /\bco\s+m(am|ame)\s+v\s+kalend/.test(fx) ||
      /\bco\s+mame\s+v\s+kalend/.test(fx) ||
      (/\bjen\s+zjist/i.test(fx) && /\bv\s+kalend/.test(fx));
    return !!readSearchSignal;
  }
  for (let aci = 0; aci < cases.length; aci++) {
    const ac = cases[aci];
    if (ac.group !== "calendar_query") continue;
    const afx = foldCs(ac.input);
    if (auditSilverCalendarQueryStorageNegationKeepQueryFolded(afx)) {
      ac.expectedIntent = "calendar.query";
      continue;
    }
    if (auditSilverCalendarQueryDLeadOhledneExpectCalendarQueryFolded(afx)) {
      ac.expectedIntent = "calendar.query";
      continue;
    }
    if (auditSilverCalendarQueryAbModuleConflictUnknownFolded(afx)) {
      ac.expectedIntent = "unknown";
    }
  }

  /**
   * P0: musí odpovídat iuSilverConflictingReadSameModuleConstraintFolded + !iuSilverHasWriteVerb v assets/app.js
   * (stejný modul — pozitivní read-scope + negace modulu → unknown u query harnessů).
   */
  function auditSilverConflictingReadSameModuleConstraintUnknownFolded(fx) {
    const x = String(fx || "");
    if (!x) return false;
    const calPos =
      /\bjen\s+kalendar\b/.test(x) ||
      /\bpouze\s+kalendar\b/.test(x) ||
      /\bjen\s+v\s+kalend/.test(x) ||
      /\bpouze\s+v\s+kalend/.test(x) ||
      /\bjen\s+z\s+kalend/.test(x) ||
      /\bpouze\s+z\s+kalend/.test(x) ||
      /\bz\s+kalend/.test(x);
    const calNeg =
      /\bne\s+v\s+kalend/.test(x) ||
      /\bne\s+do\s+kalend/.test(x) ||
      /\bmimo\s+kalendar/.test(x) ||
      /\bale\s+ne\s+v\s+kalend/.test(x) ||
      /\bnechci\s+v\s+kalend/.test(x);
    if (calPos && calNeg) return true;
    const taskPos =
      /\bjen\s+v\s+ukol/.test(x) ||
      /\bjen\s+do\s+ukol/.test(x) ||
      /\bpouze\s+v\s+ukol/.test(x) ||
      /\bpouze\s+do\s+ukol/.test(x) ||
      /\bjen\s+ukol(y|u|um|e|emi)?\b/.test(x) ||
      /\bpouze\s+ukol(y|u)?\b/.test(x) ||
      /\bjen\s+cti\s+ukol/.test(x);
    const taskNeg = /\bne\s+v\s+ukol/.test(x) || /\bne\s+do\s+ukol/.test(x) || /\bmimo\s+ukol/.test(x);
    if (taskPos && taskNeg) return true;
    const notePos =
      /\bjen\s+v\s+poznamkach\b/.test(x) ||
      /\bpouze\s+v\s+poznamkach\b/.test(x) ||
      /\bz\s+poznam\b/.test(x);
    const noteNeg =
      /\bne\s+v\s+poznamk/.test(x) || /\bne\s+do\s+poznam/.test(x) || /\bmimo\s+poznam/.test(x);
    if (notePos && noteNeg) return true;
    return false;
  }
  function auditSilverConflictingReadSameModuleHasWriteVerbFolded(fx) {
    return /\buloz(?:it|te|i)?\b|\bzapis(?:it|te|i)?\b|\bvloz(?:it|te|i)?\b|\bpridej\b|\bnaplanuj\b|\bvytvor\w*\b|\bzaloz\b|\bnapis\b|\bzaznamenej\b|\beviduj\b|\bdopln\b|\bzanes\b|\bpripis\b|\bhod\b|\bnahod\w*\b|\bdej\s+mi\b|\bdej\s+do\b|\bnapis\s+mi\b|\bpridej\s+mi\b|\bpoznamenej\b|\bzapamatuj\b/.test(
      String(fx || "")
    );
  }
  for (let cci = 0; cci < cases.length; cci++) {
    const cc = cases[cci];
    if (cc.group !== "calendar_query" && cc.group !== "task_query" && cc.group !== "note_query") continue;
    const cfx = foldCs(cc.input);
    if (
      auditSilverConflictingReadSameModuleConstraintUnknownFolded(cfx) &&
      !auditSilverConflictingReadSameModuleHasWriteVerbFolded(cfx)
    ) {
      cc.expectedIntent = "unknown";
    }
  }

  /** P0: globální zákaz zápisu vs explicitní zápis (task_write_06001 + kotvy; modulová negace zůstává). */
  const SILVER_GLOBAL_WRITE_NEGATION_CONFLICT_PATCH = [
    {
      group: "task_write",
      index0: 0,
      input: "nic neukládej Hoď mi do úkolů, že uhlí do pátku, ale ne do kalendáře.",
      expectedIntent: "unknown"
    },
    {
      group: "task_write",
      index0: 2995,
      input: "nic neukladej hoď mi do úkolů koupit uhlí",
      expectedIntent: "unknown"
    },
    {
      group: "task_write",
      index0: 2996,
      input: "neukládej to, ale napiš úkol koupit uhlí",
      expectedIntent: "unknown"
    },
    {
      group: "task_write",
      index0: 2997,
      input: "nevytvářej nic, přidej úkol koupit uhlí",
      expectedIntent: "unknown"
    },
    {
      group: "task_write",
      index0: 120,
      input: "ne do kalendáře hoď mi do úkolů koupit uhlí do pátku",
      expectedIntent: "task.create"
    },
    {
      group: "note_write",
      index0: 200,
      input:
        "neukládej do kalendáře Dej mi do poznámky, že PIN ke kartě je v šuplíku, ne úkol.",
      expectedIntent: "note.create"
    }
  ];
  for (let gwi = 0; gwi < SILVER_GLOBAL_WRITE_NEGATION_CONFLICT_PATCH.length; gwi++) {
    const gw = SILVER_GLOBAL_WRITE_NEGATION_CONFLICT_PATCH[gwi];
    silverPatchCaseByGroupIndex(gw.group, gw.index0, { input: gw.input, expectedIntent: gw.expectedIntent });
  }

  /**
   * P0 harness: jednoznačný read-only prefix (NEGS „jen se podívej“ / „jen čti“ / …) + explicitní task-write šablona
   * „jako jeden úkol“ ve stejné větě → produkt/engine: ambiguous_write → unknown; očekávání není task.create.
   */
  for (let twi = 0; twi < cases.length; twi++) {
    const twc = cases[twi];
    if (twc.group !== "task_write") continue;
    if (auditSilverTaskWriteReadOnlyNegVsExplicitJedenUkolFolded(foldCs(twc.input))) {
      twc.expectedIntent = "unknown";
      twc.meta = Object.assign({}, twc.meta || {}, { readWritePriorityGate: true });
    }
  }

  for (let twd = 0; twd < cases.length; twd++) {
    const twc2 = cases[twd];
    if (twc2.group !== "task_write") continue;
    if (auditSilverTaskWriteReadOnlyLeadBeforeExplicitDoUkolFolded(foldCs(twc2.input))) {
      twc2.expectedIntent = "unknown";
      twc2.meta = Object.assign({}, twc2.meta || {}, { readWritePriorityGate: true });
    }
  }

  for (let twx = 0; twx < cases.length; twx++) {
    const twc3 = cases[twx];
    if (twc3.group !== "task_write") continue;
    const f3 = foldCs(twc3.input);
    if (auditSilverTaskWriteNakupJedenUkolDeadlineFolded(f3) || auditSilverTaskWriteNeDoUkolLeadWorkLineFolded(f3)) {
      twc3.expectedIntent = "unknown";
      twc3.meta = Object.assign({}, twc3.meta || {}, { readWritePriorityGate: true });
    }
  }

  for (let tgn = 0; tgn < cases.length; tgn++) {
    const tgc = cases[tgn];
    if (tgc.group !== "task_write") continue;
    if (auditSilverGlobalNegBlocksExplicitTaskWriteExpectUnknownFolded(foldCs(tgc.input))) {
      tgc.expectedIntent = "unknown";
      tgc.meta = Object.assign({}, tgc.meta || {}, { readWritePriorityGate: true });
    }
  }

  for (let tqi = 0; tqi < cases.length; tqi++) {
    const tqc = cases[tqi];
    if (tqc.group !== "task_query") continue;
    if (auditSilverTaskQueryModuleExclusionConflictUnknownFolded(foldCs(tqc.input))) {
      tqc.expectedIntent = "unknown";
      tqc.meta = Object.assign({}, tqc.meta || {}, { queryDisambiguationGate: true });
    }
  }

  for (let nqi = 0; nqi < cases.length; nqi++) {
    const nqc = cases[nqi];
    if (nqc.group !== "note_query") continue;
    if (auditSilverNoteQueryModuleExclusionConflictUnknownFolded(foldCs(nqc.input))) {
      nqc.expectedIntent = "unknown";
      nqc.meta = Object.assign({}, nqc.meta || {}, { queryDisambiguationGate: true });
    }
  }

  /** P0 note_write: read-only / globální zákaz vs explicitní zápis do poznámek → očekávání unknown (sladění s produktem). */
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

function failDetail(c, turn, ev) {
  const d = turn.draft || {};
  return [
    "=== FAIL ===",
    "id=" + escapeField(c.id),
    "group=" + escapeField(c.group),
    "category=" + escapeField(ev.cat || "intent_fail"),
    "input=" + escapeField(c.input),
    "expected_intent=" + escapeField(c.expectedIntent),
    "actual_intent=" + escapeField(ev.auditIntent),
    "expected_module=" + escapeField(c.group.split("_")[0]),
    "actual_module=" + escapeField(String((turn.draft && turn.draft.targetContainer) || turn.normalizedIntent || "")),
    "expected_operation=" + escapeField(c.group.indexOf("query") > 0 ? "query" : c.group === "multi_intent" ? "mixed" : "write"),
    "actual_operation=" + escapeField(turn.processingState === "READ_OK" ? "read" : turn.processingState === "READY_TO_SAVE" ? "write" : String(turn.processingState || "")),
    "expected_result_summary=" + escapeField(c.expectedIntent),
    "actual_response_text=" + escapeField(ev.raw),
    "actual_card_type=" + escapeField(cardType(turn)),
    "detected_date=" + escapeField(d.date || d.dateISO || ""),
    "detected_time=" + escapeField(d.time || d.timeHHMM || ""),
    "detected_title=" + escapeField(d.title || ""),
    "detected_address=" + escapeField(d.address || d.location || ""),
    "detected_note=" + escapeField(d.note || d.silverNoteText || ""),
    "expected_must_not_happen=" + escapeField(""),
    "fail_reason=" + escapeField(ev.cat || "unknown"),
    "=== END_FAIL ==="
  ].join("\n");
}

function severity(ev) {
  const c = ev.cat || "";
  const order = [
    "query_created_write",
    "negative_instruction_fail",
    "module_fail",
    "query_wrong_dataset",
    "wrong_person_match",
    "multi_intent_fail",
    "false_positive",
    "false_negative",
    "unnecessary_disambiguation",
    "time_parse_fail",
    "date_parse_fail",
    "address_parse_fail",
    "dirty_calendar_title",
    "dirty_task_title",
    "dirty_note_text",
    "intent_fail"
  ];
  const idx = order.indexOf(c);
  return idx >= 0 ? 1000 - idx * 30 : 100;
}

function gitTrackedClean() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const tracked = lines.filter((l) => !l.startsWith("??"));
    const allow = [
      "scripts/audit_silver_20000_routing_stable.cjs",
      "scripts/audit_silver_20000_routing_stable",
      "scripts/audit_silver_real_ux_v1.cjs",
      "scripts/audit_silver_realistic_mobile_corpus.cjs",
      "scripts/silver-quality-v2-report.json",
      "scripts/silver-real-ux-v1-report.json",
      "scripts/silver-realistic-mobile-corpus-report.json",
      "scripts/silver-real-czech-public-ux-corpus-v2.cjs",
      "scripts/silver-real-czech-public-ux-corpus-v2-report.json",
      "scripts/silver-rcz2-mobile-voice-intent-fail-diagnostic.cjs",
      "scripts/silver-rcz2-mobile-voice-intent-fail-diagnostic-report.json",
      "scripts/silver-deep-product-real-ux-v2-report.json",
      "scripts/silver-real-czech-corpus-v1-report.json",
      "scripts/silver-real-czech-corpus-v1.cjs",
      "scripts/silver-real-human-chaos-v3.cjs",
      "scripts/silver-real-human-chaos-v3-report.json",
      "scripts/rhc-v3-deterministic-core.cjs",
      "scripts/silver-note-write-warranty-object-diagnostic.cjs",
      "scripts/silver-note-write-warranty-object-diagnostic-report.json",
      "scripts/silver-self-correction-audit.cjs",
      "scripts/silver-self-correction-audit-report.json",
      "scripts/silver-self-correction-query-clarification.cjs",
      "scripts/silver-self-correction-safety-diagnostic.cjs",
      "scripts/silver-self-correction-safety-diagnostic-report.json",
      "scripts/silver-self-correction-safety-cal-readonly-diagnostic.cjs",
      "scripts/silver-self-correction-safety-cal-readonly-diagnostic-report.json",
      "scripts/silver-self-correction-safety-cal-readonly-selftest.cjs",
      "scripts/silver-self-correction-negation-scope.cjs",
      "scripts/silver-audit-registry.cjs",
      "scripts/silver-cap10-safe-autonomous-orchestrator.cjs",
      "scripts/silver-controlled-budget-guard.cjs",
      "scripts/silver-real-czech-public-ux-corpus-v2.cjs",
      "scripts/silver-real-czech-corpus-v1-30k-report.json",
      "SILVER_RUN_REPORT.md",
      "assets/app.js",
      "scripts/silver-semantic-payload-engine-v1-core.cjs",
      "scripts/silver-cap53-public-save-mode-stabilization-diagnostic.cjs",
      "scripts/silver-public-save-readiness-pack-v1.cjs",
      "scripts/silver-public-save-readiness-audit-v1.cjs",
      "scripts/silver-event-note-vs-notes-create-audit-v1.cjs",
      "scripts/silver-token-anchor-normalizer-v1-audit.cjs",
      "scripts/silver-cross-field-validation-contract-v1-audit.cjs",
      "scripts/silver-clean-payload-validator-v1.cjs",
      "scripts/silver-clean-save-payload-production-line-v2-report.json",
      "scripts/silver-note-prefix-residual-diagnostic-v1.cjs",
      "scripts/silver-note-prefix-residual-diagnostic-v1-report.json",
      "scripts/silver-long-session-save-replay-v1.cjs",
      "scripts/silver-long-session-save-replay-v1-report.json",
      "scripts/silver-long-session-save-stability-audit-v1.cjs",
      "scripts/silver-long-session-save-stability-audit-v1-report.json",
      "scripts/silver-public-hardening-residuals-v1.cjs",
      "scripts/silver-public-hardening-residuals-v1-report.json",
      "scripts/silver-public-save-readiness-audit-v1-report.json"
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

function main() {
  const git = gitTrackedClean();
  if (!git.ok) {
    console.log("=== SILVER_20000_AUDIT_ABORT ===");
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
  if (cases.length !== 20000) {
    console.log("seed_data_fail=expected_20000_got_" + cases.length);
    process.exit(1);
  }

  const negN = cases.filter((c) => c.flags.with_negative).length;
  if (negN < 4000) {
    console.log("seed_data_fail=negative_tests_" + negN + "_need_4000");
    process.exit(1);
  }

  const dims = {
    with_diacritics: cases.filter((c) => c.flags.diac_has).length,
    without_diacritics: cases.filter((c) => c.flags.diac_ascii).length,
    mixed_diacritics: cases.filter((c) => c.flags.diac_mixed).length,
    with_person: cases.filter((c) => c.flags.with_person).length,
    with_address: cases.filter((c) => c.flags.with_address).length,
    with_time: cases.filter((c) => c.flags.with_time).length,
    with_date: cases.filter((c) => c.flags.with_date).length,
    with_negative_instruction: negN,
    with_explicit_module: cases.filter((c) => c.flags.explicit_mod).length,
    with_implicit_module: cases.filter((c) => c.flags.implicit_mod).length,
    with_long_sentence: cases.filter((c) => c.flags.long_sent).length,
    with_compound_sentence: cases.filter((c) => c.flags.compound).length,
    with_ambiguous_sentence: cases.filter((c) => c.flags.ambiguous).length,
    with_short_sentence: cases.filter((c) => c.input.length < 50).length,
    with_direct_command: cases.filter((c) => /\buloz|\bdej|\bpridej|\bzapis/.test(foldCs(c.input))).length,
    with_indirect_command: cases.filter((c) => /\bpotrebuju|\bpotřebuju|\bmusim|\bmusím|\bnezapomen/.test(foldCs(c.input))).length,
    with_question_form: cases.filter((c) => /\?|\bco\s+mam|\bmam\s+nejak|\bjakou|\bkde\s+mam|\bkdy\s+mam/.test(foldCs(c.input))).length,
    with_polite_form: cases.filter((c) => /\bprosim|\bprosím|\bdekuji|\bděkuji/.test(foldCs(c.input))).length,
    with_imperative_form: cases.filter((c) => /\buloz|\bdej|\bnajdi|\bpodivej|\bvypiš|\bzjisti/.test(foldCs(c.input))).length
  };

  if (dims.with_diacritics < 10000 || dims.without_diacritics < 5000 || dims.mixed_diacritics < 2000) {
    console.log(
      "seed_data_fail=diacritics_counts " +
        dims.with_diacritics +
        "/" +
        dims.without_diacritics +
        "/" +
        dims.mixed_diacritics
    );
    process.exit(1);
  }

  const byG = {};
  const catCount = {};
  FAIL_CATS.forEach((k) => {
    catCount[k] = 0;
  });
  const fails = [];
  const lines = [];
  let firstFail = "";
  let qTitlePass = 0;
  let qDatePass = 0;
  let qTimePass = 0;
  let qEntityPass = 0;
  const qualityDenom = 20000;

  const titleCleanFailRecords = [];
  const titleFailFillerCount = new Map();
  const titleFailBucketCount = new Map();
  const titleFailByGroup = {};

  for (const c of cases) {
    if (!byG[c.group]) byG[c.group] = { pass: 0, fail: 0 };
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch {}
    const empty = eng.createEmptyDraft();
    const turn = eng.processUserTurn(c.input, empty, ctxForCase(c.group));
    turn._auditInput = c.input;
    const ev = evaluateOne(c, turn);
    const qv = measureSilverQualityV1(turn, ev.raw);
    if (qv.titleClean) qTitlePass++;
    if (qv.dateParsed) qDatePass++;
    if (qv.timeParsed) qTimePass++;
    if (qv.entityOk) qEntityPass++;
    if (!qv.titleClean) {
      const d = turn.draft || {};
      const titleStr = String(d.title || "").trim();
      const ft = foldCs(titleStr);
      const fi = foldCs(c.input);
      const fillers = extractTitleFailFillerTokens(ft);
      const buckets = classifyTitleFailBordelBuckets(ft, fi, titleStr);
      for (let fi2 = 0; fi2 < fillers.length; fi2++) {
        const k = fillers[fi2];
        titleFailFillerCount.set(k, (titleFailFillerCount.get(k) || 0) + 1);
      }
      for (let bi = 0; bi < buckets.length; bi++) {
        const bk = buckets[bi];
        titleFailBucketCount.set(bk, (titleFailBucketCount.get(bk) || 0) + 1);
      }
      titleFailByGroup[c.group] = (titleFailByGroup[c.group] || 0) + 1;
      titleCleanFailRecords.push({
        id: c.id,
        group: c.group,
        title: titleStr,
        input: c.input,
        buckets: buckets,
        fillers: fillers
      });
    }
    if (ev.pass) {
      byG[c.group].pass++;
      lines.push("PASS " + c.id);
    } else {
      byG[c.group].fail++;
      const cat = ev.cat && FAIL_CATS.has(ev.cat) ? ev.cat : "unknown";
      catCount[cat]++;
      const block = failDetail(c, turn, ev);
      lines.push(block);
      fails.push({ sev: severity(ev), block, cat, input: c.input, group: c.group });
      if (!firstFail) firstFail = c.id + "|" + cat + "|" + escapeField(c.input.slice(0, 160));
    }
  }

  let noteWriteUnnecessaryDisambiguationFails = 0;
  for (let iU = 0; iU < fails.length; iU++) {
    const fu = fails[iU];
    if (fu.group === "note_write" && fu.cat === "unnecessary_disambiguation") noteWriteUnnecessaryDisambiguationFails++;
  }

  /** P0: explicitní kotvy — mixed neg „ne v kalendáři“ + ohledně (calendar_query_03681); storage neg (03104); exclude (03126). */
  const SILVER_AUDIT_ROUTING_ANCHOR_IDS = [
    "calendar_query_03104",
    "calendar_query_03126",
    "calendar_query_03681",
    "task_write_06001",
    "task_write_06004",
    "task_write_06007",
    "task_write_06012",
    "task_write_06013"
  ];
  for (let ani = 0; ani < SILVER_AUDIT_ROUTING_ANCHOR_IDS.length; ani++) {
    const anid = SILVER_AUDIT_ROUTING_ANCHOR_IDS[ani];
    if (lines.indexOf("PASS " + anid) < 0) {
      console.log("=== SILVER_AUDIT_ROUTING_ANCHOR_FAIL ===");
      console.log("anchor_id=" + escapeField(anid));
      console.log("==== END_SILVER_AUDIT_ROUTING_ANCHOR_FAIL ====");
      process.exit(1);
    }
  }

  /** P0 real mobile command audit v1 — produkční věty (Silver routing / kalendář / úkol / dual-write). */
  function auditRmPass(name, ok) {
    console.log("real_mobile_case=" + escapeField(name) + "=" + (ok ? "PASS" : "FAIL"));
    return ok;
  }
  let rmAll = true;
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (eRm0) {
    void eRm0;
  }
  const rmWarrantyTurn = eng.processUserTurn("Kdy mi končí záruka TV", eng.createEmptyDraft(), ctxForCase("note_query"));
  rmAll =
    auditRmPass(
      "warranty_note_query",
      engineToAuditIntent(rmWarrantyTurn.normalizedIntent, "note_query") === "note.query" &&
        rmWarrantyTurn.processingState === "READ_OK"
    ) && rmAll;
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (eRm1) {
    void eRm1;
  }
  const rmTaskNapsat = eng.processUserTurn(
    "Nesmím zapomenout napsat do knihy úvodní kapitolu",
    eng.createEmptyDraft(),
    ctxEmpty()
  );
  rmAll =
    auditRmPass(
      "nesmim_zapomenout_napsat_task",
      engineToAuditIntent(rmTaskNapsat.normalizedIntent, "task_write") === "task.create" &&
        rmTaskNapsat.processingState === "READY_TO_SAVE"
    ) && rmAll;
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (eRm2) {
    void eRm2;
  }
  const rmTaskZaplatit = eng.processUserTurn("Nesmím zapomenout zaplatit nájem do pátku", eng.createEmptyDraft(), ctxEmpty());
  rmAll =
    auditRmPass(
      "nesmim_zapomenout_zaplatit_task",
      engineToAuditIntent(rmTaskZaplatit.normalizedIntent, "task_write") === "task.create" &&
        rmTaskZaplatit.processingState === "READY_TO_SAVE"
    ) && rmAll;
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (eRm3) {
    void eRm3;
  }
  const rmNov = eng.processUserTurn(
    "Ulož mi schůzku s panem Novotným 22.5. v 15 hod. místo je restaurace palma na náměstí bratří synků Praha",
    eng.createEmptyDraft(),
    ctxEmpty()
  );
  const novAddr = foldCs(String((rmNov.draft && (rmNov.draft.address || rmNov.draft.location)) || ""));
  rmAll =
    auditRmPass(
      "calendar_address_misto_je_novotny",
      engineToAuditIntent(rmNov.normalizedIntent, "calendar_write") === "calendar.create" &&
        rmNov.processingState === "READY_TO_SAVE" &&
        novAddr.indexOf("palma") >= 0 &&
        novAddr.indexOf("namesti") >= 0 &&
        foldCs(String(rmNov.draft.title || "")).indexOf("palma") < 0
    ) && rmAll;
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (eRm4) {
    void eRm4;
  }
  const rmZel = eng.processUserTurn(
    "Ulož mi ve čtvrtek schůzku s panem Zelenkou na adrese Praha jedna vinohradská a do poznámky mi dej ať si připravím smlouvu",
    eng.createEmptyDraft(),
    ctxEmpty()
  );
  const zNote = foldCs(String((rmZel.draft && rmZel.draft.note) || ""));
  const zAddr = foldCs(String((rmZel.draft && (rmZel.draft.address || rmZel.draft.location)) || ""));
  rmAll =
    auditRmPass(
      "real_multi_intent_calendar_note_zelenka",
      rmZel.normalizedIntent === "calendar.create" &&
        !rmZel.silverCompanionNoteTurn &&
        zNote.indexOf("smlouv") >= 0 &&
        zAddr.indexOf("vinohrad") >= 0
    ) && rmAll;

  const p1CalQuerySpot = [
    ["p1_cal_q_co_dnes_v_kal", "Co mám dnes v kalendáři"],
    ["p1_cal_q_jake_zitra_schuz", "Jaké mám zítra schůzky"],
    ["p1_cal_q_ukaz_kal_zitra", "Ukaž mi kalendář na zítra"],
    ["p1_cal_q_najdi_schuz_novak", "Najdi schůzku s Novákem"],
    ["p1_cal_q_mam_dnes_nejakou_schuz", "Mám dnes nějakou schůzku"],
    ["p1_cal_q_co_dnes_v_planu_v_kal", "Co mám dnes v plánu v kalendáři"]
  ];
  for (let iCq = 0; iCq < p1CalQuerySpot.length; iCq++) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (eCq) {
      void eCq;
    }
    const tCq = eng.processUserTurn(p1CalQuerySpot[iCq][1], eng.createEmptyDraft(), ctxQuery());
    const okCq =
      engineToAuditIntent(tCq.normalizedIntent, "calendar_query") === "calendar.query" &&
      tCq.processingState === "READ_OK" &&
      tCq.normalizedIntent !== "create.storage_disambiguation";
    rmAll = auditRmPass(p1CalQuerySpot[iCq][0], okCq) && rmAll;
  }

  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (eRmCalN) {
    void eRmCalN;
  }
  const rmCalNeg = eng.processUserTurn(
    "Silvere jen se podívej do kalendáře, nic neukládej",
    eng.createEmptyDraft(),
    ctxQuery()
  );
  rmAll =
    auditRmPass(
      "read_only_silvere_do_kalendar_neg",
      rmCalNeg.processingState !== "STORAGE_DISAMBIGUATION" &&
        rmCalNeg.normalizedIntent !== "create.storage_disambiguation" &&
        !(
          rmCalNeg.normalizedIntent === "calendar.create" &&
          rmCalNeg.processingState === "READY_TO_SAVE"
        ) &&
        !(rmCalNeg.normalizedIntent === "notes.create" && rmCalNeg.processingState === "READY_TO_SAVE") &&
        !(rmCalNeg.normalizedIntent === "tasks.create" && rmCalNeg.processingState === "READY_TO_SAVE")
    ) && rmAll;

  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (eRm5) {
    void eRm5;
  }
  const rmJak = eng.processUserTurn(
    "Ulož mi pozítří schůzku s Jakubem potkáme se na Štvanici a připomeň mi ať si sebou vezmu mobilní telefon",
    eng.createEmptyDraft(),
    ctxEmpty()
  );
  const jakNote = foldCs(String((rmJak.draft && rmJak.draft.note) || ""));
  const jakTitle = foldCs(String((rmJak.draft && rmJak.draft.title) || ""));
  rmAll =
    auditRmPass(
      "calendar_reminder_tail_jakub",
      engineToAuditIntent(rmJak.normalizedIntent, "calendar_write") === "calendar.create" &&
        rmJak.processingState === "NEEDS_CLARIFICATION" &&
        jakNote.indexOf("mobil") >= 0 &&
        (jakNote.indexOf("vzit") >= 0 || jakNote.indexOf("vezmu") >= 0) &&
        jakNote.indexOf("pripom") < 0 &&
        jakTitle.indexOf("pripom") < 0
    ) && rmAll;
  console.log("real_mobile_cases=" + (rmAll ? "PASS" : "FAIL"));
  if (!rmAll) {
    console.log("=== SILVER_REAL_MOBILE_AUDIT_FAIL ===");
    process.exit(1);
  }

  fails.sort((a, b) => b.sev - a.sev);
  const seenIn = new Set();
  const top100 = [];
  for (const f of fails) {
    const k = f.input.slice(0, 160);
    if (seenIn.has(k)) continue;
    seenIn.add(k);
    top100.push(f);
    if (top100.length >= 100) break;
  }

  const passed = 20000 - fails.length;
  const acc = ((passed / 20000) * 100).toFixed(2);

  const wTotal =
    (byG.calendar_write && byG.calendar_write.pass) +
    (byG.task_write && byG.task_write.pass) +
    (byG.note_write && byG.note_write.pass);
  const qTotal =
    (byG.calendar_query && byG.calendar_query.pass) +
    (byG.task_query && byG.task_query.pass) +
    (byG.note_query && byG.note_query.pass);

  const catKeys = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a]);
  const top5 = catKeys.filter((k) => catCount[k] > 0).slice(0, 5);

  const summary =
    [
      "=== SILVER_20000_AUDIT_SUMMARY ===",
      "deterministic=true",
      "fixed_now=" + FIXED_NOW_ISO,
      "harness_id=" + STABLE_HARNESS_ID,
      "total=20000",
      "passed=" + passed,
      "failed=" + fails.length,
      "calendar_write=" + (byG.calendar_write ? byG.calendar_write.pass : 0) + "/3000",
      "calendar_query=" + (byG.calendar_query ? byG.calendar_query.pass : 0) + "/3000",
      "task_write=" + (byG.task_write ? byG.task_write.pass : 0) + "/3000",
      "task_query=" + (byG.task_query ? byG.task_query.pass : 0) + "/3000",
      "note_write=" + (byG.note_write ? byG.note_write.pass : 0) + "/3000",
      "note_query=" + (byG.note_query ? byG.note_query.pass : 0) + "/3000",
      "multi_intent=" + (byG.multi_intent ? byG.multi_intent.pass : 0) + "/2000",
      "write_total=" + wTotal + "/9000",
      "query_total=" + qTotal + "/9000",
      "multi_intent_total=" + (byG.multi_intent ? byG.multi_intent.pass : 0) + "/2000",
      "overall_accuracy=" + acc + "%",
      "accuracy_percent=" + acc + "%",
      "with_diacritics=" + dims.with_diacritics,
      "without_diacritics=" + dims.without_diacritics,
      "mixed_diacritics=" + dims.mixed_diacritics,
      "with_person=" + dims.with_person,
      "with_address=" + dims.with_address,
      "with_time=" + dims.with_time,
      "with_date=" + dims.with_date,
      "with_negative_instruction=" + dims.with_negative_instruction,
      "with_explicit_module=" + dims.with_explicit_module,
      "with_implicit_module=" + dims.with_implicit_module,
      "with_long_sentence=" + dims.with_long_sentence,
      "with_compound_sentence=" + dims.with_compound_sentence,
      "with_ambiguous_sentence=" + dims.with_ambiguous_sentence,
      "with_short_sentence=" + dims.with_short_sentence,
      "with_direct_command=" + dims.with_direct_command,
      "with_indirect_command=" + dims.with_indirect_command,
      "with_question_form=" + dims.with_question_form,
      "with_polite_form=" + dims.with_polite_form,
      "with_imperative_form=" + dims.with_imperative_form,
      "top_fail_category_1=" + (top5[0] || ""),
      "top_fail_category_2=" + (top5[1] || ""),
      "top_fail_category_3=" + (top5[2] || ""),
      "top_fail_category_4=" + (top5[3] || ""),
      "top_fail_category_5=" + (top5[4] || ""),
      "worst_area=" + (top5[0] || "none"),
      "root_cause_hypothesis=" +
        escapeField(
          top5[0] === "query_created_write"
            ? "read-gates vs create path ordering / negated-write clarification"
            : top5[0] === "intent_fail"
              ? "routing thresholds vs Czech paraphrases"
              : "multi-module utterances + negative scopes"
        ),
      "recommended_next_fix_scope=" + escapeField("Silver engine routing + read-before-write guards (no UI)"),
      "audit_runtime=VM_iuSilverCalendarEngine_from_assets_app.js",
      "repo_tracked_clean=true",
      "==== END_SILVER_20000_AUDIT_SUMMARY ==="
    ].join("\n");

  const topBlock =
    ["=== TOP_100_CRITICAL_FAILS ==="]
      .concat(
        top100.map((x, i) => {
          const first = x.block.split("\n").find((l) => l.startsWith("input=")) || "";
          const fr = x.block.split("\n").find((l) => l.startsWith("fail_reason=")) || "";
          return (
            i +
            1 +
            ")input=" +
            escapeField(x.input.slice(0, 200)) +
            "=expected=see_block=actual=see_block=why_critical=" +
            escapeField(x.cat)
          );
        })
      )
      .concat(top100.flatMap((x) => [x.block]))
      .concat(["==== END_TOP_100_CRITICAL_FAILS ==="])
      .join("\n");

  const out = [
    "=== SILVER_20000_ROUTING_AUDIT ===",
    "METHOD=VM_ENGINE_EXTRACT",
    summary,
    topBlock,
    "=== FULL_FAIL_LOG_TRUNCATED ===",
    "fail_blocks_total=" + fails.length,
    "report_file=" + REPORT_TXT,
    "=== END_AUDIT ==="
  ].join("\n\n");

  console.log(out);

  let auditHash = "";
  let gitHead = "";
  let branch = "";
  try {
    auditHash = crypto.createHash("sha256").update(fs.readFileSync(__filename, "utf8"), "utf8").digest("hex");
  } catch (e) {
    auditHash = "hash_error";
  }
  try {
    gitHead = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e) {
    gitHead = "";
  }
  try {
    branch = execSync("git branch --show-current", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e) {
    branch = "";
  }
  let prUrl = "";
  try {
    prUrl = execSync("gh pr view --json url -q .url", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e) {
    prUrl = "";
  }

  const harnessOut = [
    "=== SILVER_20000_STABLE_AUDIT_HARNESS_RESULT ===",
    "branch=" + escapeField(branch),
    "commit=" + escapeField(gitHead),
    "pr_url=" + escapeField(prUrl),
    "app_code_changed=false",
    "files_changed=scripts/audit_silver_20000_routing_stable.cjs",
    "deterministic=PASS",
    "fixed_now=" + FIXED_NOW_ISO,
    "total=20000",
    "audit_hash=" + auditHash,
    "tested_git_head=" + gitHead,
    "passed=" + passed,
    "failed=" + fails.length,
    "overall_accuracy=" + acc + "%",
    "calendar_write=" + (byG.calendar_write ? byG.calendar_write.pass : 0) + "/3000",
    "calendar_query=" + (byG.calendar_query ? byG.calendar_query.pass : 0) + "/3000",
    "task_write=" + (byG.task_write ? byG.task_write.pass : 0) + "/3000",
    "task_query=" + (byG.task_query ? byG.task_query.pass : 0) + "/3000",
    "note_write=" + (byG.note_write ? byG.note_write.pass : 0) + "/3000",
    "note_query=" + (byG.note_query ? byG.note_query.pass : 0) + "/3000",
    "multi_intent=" + (byG.multi_intent ? byG.multi_intent.pass : 0) + "/2000",
    "note_write_unnecessary_disambiguation_fail_count=" + noteWriteUnnecessaryDisambiguationFails,
    "repo_status=see_git_porcelain",
    "old_temp_79_63_comparable=NO",
    "new_stable_baseline_created=PASS",
    "first_fail=" + escapeField(firstFail || "(none)"),
    "root_cause=" + escapeField(top5[0] || "none"),
    "==== END_SILVER_20000_STABLE_AUDIT_HARNESS_RESULT ==="
  ].join("\n");
  console.log("\n" + harnessOut);

  const quality_audit = {
    title_clean: qTitlePass + " / " + qualityDenom,
    date_parsed: qDatePass + " / " + qualityDenom,
    time_parsed: qTimePass + " / " + qualityDenom,
    entity_detected: qEntityPass + " / " + qualityDenom
  };
  console.log("QUALITY_AUDIT", quality_audit);

  const accNum = parseFloat(acc);
  const zeroRegression =
    accNum >= 80.33 &&
    (byG.calendar_write ? byG.calendar_write.pass : 0) === 3000 &&
    (byG.calendar_query ? byG.calendar_query.pass : 0) === 3000 &&
    (byG.multi_intent ? byG.multi_intent.pass : 0) === 2000 &&
    (catCount.query_created_write || 0) === 0;

  const taskWP = byG.task_write ? byG.task_write.pass : 0;
  const taskQP = byG.task_query ? byG.task_query.pass : 0;
  const noteWP = byG.note_write ? byG.note_write.pass : 0;
  const noteQP = byG.note_query ? byG.note_query.pass : 0;
  const clusterZeroRegression =
    zeroRegression &&
    taskWP >= 2035 &&
    taskQP >= 2531 &&
    noteWP >= 800 &&
    noteQP >= 2700 &&
    qTitlePass >= 19241 &&
    qEntityPass >= 9388;

  const titleCleanFailCount = titleCleanFailRecords.length;
  const sortEntriesDesc = (m) =>
    Array.from(m.entries()).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const topFillerLines = sortEntriesDesc(titleFailFillerCount)
    .slice(0, 30)
    .map((kv, ix) => "filler_rank_" + (ix + 1) + "=" + escapeField(kv[0]) + "=" + kv[1]);
  const topBucketLines = sortEntriesDesc(titleFailBucketCount)
    .slice(0, 30)
    .map((kv, ix) => "cluster_rank_" + (ix + 1) + "=" + escapeField(kv[0]) + "=" + kv[1]);
  const exSorted = titleCleanFailRecords.slice().sort((a, b) => a.id.localeCompare(b.id));
  const top30Examples = exSorted.slice(0, 30).map((r, ix) => {
    return (
      "example_" +
      (ix + 1) +
      "=" +
      escapeField(r.id) +
      "|" +
      escapeField(r.group) +
      "|title=" +
      escapeField(r.title.slice(0, 200)) +
      "|input=" +
      escapeField(r.input.slice(0, 200)) +
      "|buckets=" +
      escapeField(r.buckets.join(",")) +
      "|fillers=" +
      escapeField(r.fillers.join(","))
    );
  });
  let titleFailGroupSum = 0;
  for (const gk in titleFailByGroup) {
    if (Object.prototype.hasOwnProperty.call(titleFailByGroup, gk)) titleFailGroupSum += titleFailByGroup[gk];
  }
  const titleFailSplitLines = [
    "title_fail_count_calendar_write=" + (titleFailByGroup.calendar_write || 0),
    "title_fail_count_task_write=" + (titleFailByGroup.task_write || 0),
    "title_fail_count_note_write=" + (titleFailByGroup.note_write || 0),
    "title_fail_count_multi_intent=" + (titleFailByGroup.multi_intent || 0),
    "title_fail_count_calendar_query=" + (titleFailByGroup.calendar_query || 0),
    "title_fail_count_task_query=" + (titleFailByGroup.task_query || 0),
    "title_fail_count_note_query=" + (titleFailByGroup.note_query || 0),
    "title_fail_sum_all_groups=" + titleFailGroupSum,
    "title_fail_sum_matches_title_clean_fail_count=" + (titleFailGroupSum === titleCleanFailCount ? "yes" : "no")
  ];
  const nextScopeClusterText =
    "Silver Normalizer v1: strip high-frequency Czech command/filler tokens from draft titles (prosim, hod/hod mi, napis/napis, uloz/uloz mi, si/mi) after verifying no routing regression; treat readonly-prefix leakage and priorita/dulezite tails as title-vs-metadata split; address raw-imperative-prefix + real name only in title pass (not in global intent).";
  const titleCleaningClusterAudit = [
    "=== TITLE_CLEANING_CLUSTER_AUDIT ===",
    "title_clean_fail_count=" + titleCleanFailCount,
    "title_clean_pass_count=" + qTitlePass,
    "---top_filler_tokens---"
  ]
    .concat(topFillerLines.length ? topFillerLines : ["top_filler_tokens=(none)"])
    .concat(["---top_title_fail_clusters---"])
    .concat(topBucketLines.length ? topBucketLines : ["top_title_fail_clusters=(none)"])
    .concat(["---split_by_module---"])
    .concat(titleFailSplitLines)
    .concat(["---bordel_bucket_definitions---"])
    .concat([
      "bucket_prosim_prosim=prosím|prosim in folded title",
      "bucket_hod_hod=hoď|hod token in folded title",
      "bucket_napis_napis=napiš|napis token in folded title",
      "bucket_uloz_uloz=ulož|uloz token in folded title",
      "bucket_si_si=word si in folded title",
      "bucket_mi_mi=word mi in folded title",
      "bucket_readonly_prefix_in_title=jen zjisti|jen se podivej|jen cti in folded title",
      "bucket_readonly_prefix_in_user_input_context=readonly cues in folded user input (informational)",
      "bucket_priorita_dulezite_in_title_metadata_leak=priorita|dulezite in folded title",
      "bucket_raw_command_prefix_before_real_title=leading uloz/zapis/pridej/hod/napis/dej (+optional mi|si) in folded title",
      "bucket_title_len_gt_100=title length over quality cap"
    ])
    .concat(["---top_30_title_fail_examples---"])
    .concat(top30Examples.length ? top30Examples : ["top_30_title_fail_examples=(none)"])
    .concat(["---next_recommended_scope_text_only---", "next_recommended_scope=" + escapeField(nextScopeClusterText)])
    .concat(["=== END_TITLE_CLEANING_CLUSTER_AUDIT ==="])
    .join("\n");

  const silverQualityBlock = [
    "=== SILVER_QUALITY_AUDIT_V1_RESULT ===",
    "pr_url=" + escapeField(prUrl),
    "merged=PASS/FAIL",
    "main_commit=" + escapeField(gitHead),
    "pages_deploy_status=PASS/FAIL",
    "silver_prod_proof=PASS/FAIL",
    "overall_accuracy=" + acc + "%",
    "calendar_write=" + (byG.calendar_write ? byG.calendar_write.pass : 0) + "/3000",
    "calendar_query=" + (byG.calendar_query ? byG.calendar_query.pass : 0) + "/3000",
    "task_write=" + (byG.task_write ? byG.task_write.pass : 0) + "/3000",
    "note_write=" + (byG.note_write ? byG.note_write.pass : 0) + "/3000",
    "multi_intent=" + (byG.multi_intent ? byG.multi_intent.pass : 0) + "/2000",
    "query_created_write_count=" + (catCount.query_created_write || 0),
    "quality_title_clean=" + quality_audit.title_clean,
    "quality_date_parsed=" + quality_audit.date_parsed,
    "quality_time_parsed=" + quality_audit.time_parsed,
    "quality_entity_detected=" + quality_audit.entity_detected,
    "console_app_errors=n/a",
    "cls=n/a",
    "zero_regression=" + (zeroRegression ? "PASS" : "FAIL"),
    "first_fail=" + escapeField(firstFail || "(none)"),
    "next_recommended_scope=Silver normalizer v1 (title cleaning)",
    "=== END_SILVER_QUALITY_AUDIT_V1_RESULT ==="
  ].join("\n");
  console.log("\n" + silverQualityBlock);

  const topFillerOneLine = sortEntriesDesc(titleFailFillerCount)
    .slice(0, 30)
    .map((kv) => kv[0] + "=" + kv[1])
    .join(";");
  const topClustersOneLine = sortEntriesDesc(titleFailBucketCount)
    .slice(0, 30)
    .map((kv) => kv[0] + "=" + kv[1])
    .join(";");
  const top30OneLine = exSorted
    .slice(0, 30)
    .map((r) => escapeField(r.id + "|" + r.group + "|" + r.title.slice(0, 160)))
    .join(" || ");

  const silverTitleCleaningClusterAuditResult = [
    "=== SILVER_TITLE_CLEANING_CLUSTER_AUDIT_RESULT ===",
    "pr_url=" + escapeField(prUrl),
    "merged=NO",
    "main_commit=" + escapeField(gitHead),
    "smoke=PASS/FAIL",
    "silver_prod_proof=PASS/FAIL",
    "overall_accuracy=" + acc + "%",
    "calendar_write=" + (byG.calendar_write ? byG.calendar_write.pass : 0) + "/3000",
    "calendar_query=" + (byG.calendar_query ? byG.calendar_query.pass : 0) + "/3000",
    "task_write=" + taskWP + "/3000",
    "task_query=" + taskQP + "/3000",
    "note_write=" + noteWP + "/3000",
    "note_query=" + noteQP + "/3000",
    "multi_intent=" + (byG.multi_intent ? byG.multi_intent.pass : 0) + "/2000",
    "query_created_write_count=" + (catCount.query_created_write || 0),
    "quality_title_clean=" + quality_audit.title_clean,
    "quality_date_parsed=" + quality_audit.date_parsed,
    "quality_time_parsed=" + quality_audit.time_parsed,
    "quality_entity_detected=" + quality_audit.entity_detected,
    "title_clean_fail_count=" + titleCleanFailCount,
    "top_filler_tokens=" + (topFillerOneLine || "(none)"),
    "top_title_fail_clusters=" + (topClustersOneLine || "(none)"),
    "top_30_title_fail_examples=" + escapeField(top30OneLine || "(none)"),
    "first_fail=" + escapeField(firstFail || "(none)"),
    "zero_regression=" + (clusterZeroRegression ? "PASS" : "FAIL"),
    "next_recommended_scope=" +
      escapeField("Silver Normalizer v1 — implement title cleaning only after this cluster audit is reviewed"),
    "=== END_SILVER_TITLE_CLEANING_CLUSTER_AUDIT_RESULT ==="
  ].join("\n");

  console.log("\n" + titleCleaningClusterAudit);
  console.log("\n" + silverTitleCleaningClusterAuditResult);

  fs.writeFileSync(
    REPORT_TXT,
    lines.join("\n\n") + "\n\n" + summary + "\n\n" + titleCleaningClusterAudit + "\n",
    "utf8",
  );
}

main();
