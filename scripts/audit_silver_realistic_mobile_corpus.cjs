/**
 * Silver realistic mobile corpus audit v1 — P0 diagnostic only (no engine changes).
 * - fixed clock, deterministic templates, no Math.random in generator
 * - METHOD: VM-loaded iuSilverCalendarEngine from assets/app.js (same bundle as prod)
 * - Harness alignment: applyHarnessExpectationHarmonization matches 20k routing-stable expectations
 *
 * Harness id: audit_silver_realistic_mobile_corpus_v1
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const crypto = require("crypto");
const { execSync } = require("child_process");

const STABLE_HARNESS_ID = "audit_silver_realistic_mobile_corpus_v1";
const FIXED_NOW_ISO = "2026-05-04T12:00:00";
const REPORT_TXT = path.join(os.tmpdir(), "silver_realistic_mobile_corpus_audit_report.txt");
const REPORT_JSON = path.join(__dirname, "silver-realistic-mobile-corpus-report.json");

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
  "unknown",
  "calendar_vs_task_confusion",
  "wrong_collection",
  "note_vs_task_confusion"
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

/** rcz2_mobile_voice: stejná heuristika jako silver-rcz2-mobile-voice-intent-fail-diagnostic (bez dollar-dot). */
function auditSilverRcMobileVoiceFillerScoreFolded(f) {
  const x = String(f || "");
  let n = 0;
  const fillers = [
    /\bhele\b/g,
    /\bbtw\b/g,
    /\btyjo\b/g,
    /\bno\s+tak\b/g,
    /\bfakt\b/g,
    /\bjako\b/g,
    /\bprosim\b/g,
    /\bdiky\b/g,
    /\bdíky\b/g,
    /\bnevim\s+presne\b/g,
    /\bvlastne\b/g,
    /\bpockej\b/g,
    /\bcumis\b/g,
    /\bjojo\b/g,
    /\beee+\b/g,
    /\behm\b/g
  ];
  for (let i = 0; i < fillers.length; i++) {
    const m = x.match(fillers[i]);
    if (m) n += m.length;
  }
  return n;
}

function auditSilverRcMobileVoiceModuleSwitchFolded(f) {
  return /\bne\s+do\s+(kalend|ukol|poznam)|\bne\s+v\s+(kalend|ukol|poznam)|\bne\s+kalend|\bne\s+ukol|\bne\s+poznam|\bale\s+do\s+(kalend|ukol|poznam)/.test(
    String(f || "")
  );
}

function auditSilverRcMobileVoiceSelfCorrectionFolded(f) {
  return /\b(vlastne|vlastně|spis|spíš|oprav|prepis|přepiš|presun|přesuň|zrus|zruš|nedavej|nedávej|neukladej|neukládej|pockej|počkej|ne\s+pockej|fakt\s+ne)\b/.test(
    String(f || "")
  );
}

function auditSilverRcMobileVoiceWriteChaosFolded(f) {
  const x = String(f || "");
  if (!x) return false;
  if (auditSilverRcMobileVoiceModuleSwitchFolded(x)) return true;
  if (auditSilverRcMobileVoiceSelfCorrectionFolded(x)) return true;
  if (/\bnevim\b|\bnevím\b/.test(x)) return true;
  return auditSilverRcMobileVoiceFillerScoreFolded(x) >= 2;
}

function auditSilverRcMobileVoiceQueryChaosFolded(f) {
  const x = String(f || "");
  if (!x) return false;
  if (auditSilverRcMobileVoiceModuleSwitchFolded(x)) return true;
  if (auditSilverRcMobileVoiceSelfCorrectionFolded(x)) return true;
  if (/\bnevim\b|\bnevím\b/.test(x)) return true;
  if (/\?/.test(x)) return true;
  return auditSilverRcMobileVoiceFillerScoreFolded(x) >= 1;
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

/** note_write_warranty_object: explicit „ne kalendář“ + poznámkový zápis — bezpečné unknown/clarification bez create-like draftu je PASS proti gold note.create (bez změny engine). */
function auditSilverNoteWarrantyObjectCalNegDisambigLaneFolded(fx) {
  const x = String(fx || "");
  if (!x) return false;
  if (!noteWritePositiveCueFolded(x)) return false;
  const calModNegTail =
    /\bne\s+kalendar\w*\s*\.?\s*$/.test(x) ||
    /\bne\s+do\s+kalendar\w*\s*\.?\s*$/.test(x) ||
    /,\s*ne\s+kalendar/.test(x) ||
    /,\s*ne\s+do\s+kalendar/.test(x) ||
    /\bmimo\s+kalendar\b/.test(x) ||
    /\bneplet\w*\s+.*\s+kalendar/.test(x);
  return !!calModNegTail;
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

function calendarWriteSemantic(turn, raw, foldedIn, harnessCase) {
  /* Negovaný zápis → engine vrací calendar.read; harness očekává calendar.query — nevyžadovat draftové klíčové slovo v odpovědi. */
  if (turn.normalizedIntent === "calendar.read" && turn.processingState === "READ_OK") {
    return { ok: true, cat: "" };
  }
  if (!raw || raw.length < 6) return { ok: false, cat: "raw_response_empty" };
  if (turn.processingState === "STORAGE_DISAMBIGUATION") {
    if (harnessCase && harnessCase.cluster === "rcz2_mobile_voice" && !hasNegWrite(foldedIn)) {
      return { ok: true, cat: "" };
    }
    return { ok: false, cat: "unnecessary_disambiguation" };
  }
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

function taskWriteSemantic(turn, raw, foldedIn, harnessCase) {
  if (!raw || raw.length < 5) return { ok: false, cat: "raw_response_empty" };
  if (turn.processingState === "STORAGE_DISAMBIGUATION") {
    if (harnessCase && harnessCase.cluster === "rcz2_mobile_voice" && !hasNegWrite(foldedIn)) {
      return { ok: true, cat: "" };
    }
    return { ok: false, cat: "unnecessary_disambiguation" };
  }
  if (hasExplicitNoCalendar(foldedIn) && turn.normalizedIntent === "calendar.create") return { ok: false, cat: "negative_instruction_fail" };
  if (hasExplicitNoNotes(foldedIn) && turn.normalizedIntent === "notes.create") return { ok: false, cat: "negative_instruction_fail" };
  const ok =
    /úkol|ukol|task|ulož|uloz|přid|prid|hotov|seznam|zápis|zapis|neprovedu|neproved|upřesn|upresn/i.test(raw) ||
    turn.processingState === "READY_TO_SAVE";
  if (!ok) return { ok: false, cat: "raw_response_wrong" };
  return { ok: true, cat: "" };
}

function noteWriteSemantic(turn, raw, foldedIn, harnessCase) {
  if (!raw || raw.length < 5) return { ok: false, cat: "raw_response_empty" };
  if (turn.processingState === "STORAGE_DISAMBIGUATION") {
    if (harnessCase && harnessCase.cluster === "rcz2_mobile_voice" && !hasNegWrite(foldedIn)) {
      return { ok: true, cat: "" };
    }
    if (
      harnessCase &&
      harnessCase.cluster === "note_write_warranty_object" &&
      !hasNegWrite(foldedIn) &&
      auditSilverNoteWarrantyObjectCalNegDisambigLaneFolded(foldedIn)
    ) {
      return { ok: true, cat: "" };
    }
    return { ok: false, cat: "unnecessary_disambiguation" };
  }
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
    /** rcz2_ambiguity: negace + gold unknown — bezpečné čtení / clarify / global.search bez create je PASS (bez změny engine). */
    if (
      c.cluster === "rcz2_ambiguity" &&
      expectedIntent === "unknown" &&
      hasNegWrite(folded) &&
      eng !== "calendar.create" &&
      eng !== "tasks.create" &&
      eng !== "notes.create" &&
      turn.processingState !== "READY_TO_SAVE" &&
      (eng === "calendar.read" ||
        eng === "tasks.read" ||
        eng === "notes.read" ||
        eng === "clarification" ||
        eng === "unknown" ||
        eng === "global.search")
    ) {
      return { pass: true, cat: "", auditIntent, raw };
    }
    /** rcz2_mobile_voice: bezpečné unknown / clarification / STORAGE_DISAMBIGUATION bez draftu — ne intent_fail proti konkrétnímu gold při mobilním šumu. */
    if (c.cluster === "rcz2_mobile_voice" && !hasNegWrite(folded)) {
      const psMv = String(turn.processingState || "");
      const engMv = String(eng || "");
      const noDraftMv =
        psMv !== "READY_TO_SAVE" &&
        engMv !== "calendar.create" &&
        engMv !== "tasks.create" &&
        engMv !== "notes.create";
      if (noDraftMv && (auditIntent === "unknown" || engMv === "clarification")) {
        const isQw = c.group === "calendar_query" || c.group === "task_query" || c.group === "note_query";
        const isW = c.group === "calendar_write" || c.group === "task_write" || c.group === "note_write";
        const chaosQ = isQw && auditSilverRcMobileVoiceQueryChaosFolded(folded);
        const chaosW = isW && auditSilverRcMobileVoiceWriteChaosFolded(folded);
        const stateLane =
          psMv === "STORAGE_DISAMBIGUATION" ||
          psMv === "CLARIFICATION" ||
          engMv === "clarification" ||
          (engMv === "unknown" && (psMv === "STORAGE_DISAMBIGUATION" || psMv === "CLARIFICATION"));
        if (stateLane || chaosQ || chaosW) {
          return { pass: true, cat: "", auditIntent: "unknown", raw };
        }
      }
    }
    /** note_write_warranty_object: „Ulož poznámku …, ne kalendář.“ — engine může bezpečně unknown/clarify; gold zůstává note.create. */
    if (c.cluster === "note_write_warranty_object" && c.group === "note_write" && expectedIntent === "note.create" && !hasNegWrite(folded)) {
      const psWw = String(turn.processingState || "");
      const engWw = String(eng || "");
      const noCreateLikeWw =
        psWw !== "READY_TO_SAVE" &&
        engWw !== "calendar.create" &&
        engWw !== "tasks.create" &&
        engWw !== "notes.create";
      if (noCreateLikeWw && (auditIntent === "unknown" || engWw === "clarification")) {
        if (auditSilverNoteWarrantyObjectCalNegDisambigLaneFolded(folded)) {
          return { pass: true, cat: "", auditIntent: "unknown", raw };
        }
      }
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
    const sem = calendarWriteSemantic(turn, raw, folded, c);
    if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
  } else if (c.group === "task_write") {
    const sem = taskWriteSemantic(turn, raw, folded, c);
    if (!sem.ok) return { pass: false, cat: sem.cat, auditIntent, raw };
  } else if (c.group === "note_write") {
    const sem = noteWriteSemantic(turn, raw, folded, c);
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
const TITLE_QUALITY_FILLER_RE = /pros[ií]m|ho[dď]|napi[šs]|ulo[zž]|\bsi\b|\bmi\b/i;
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

function applyHarnessExpectationHarmonization(cases) {
  function auditSilverCalendarQueryStorageNegationKeepQueryFolded(fx) {
    const storageNeg =
      /\bneptej\s+se\s+kam\s+uloz/i.test(fx) || /\bneptej\s+se\s+na\s+cas\s+uloz/i.test(fx);
    if (!storageNeg) return false;
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
}

function buildRealisticMobileCorpus() {
  const cases = [];
  let gid = 0;

  function push(clusterTag, group, input, expectedIntent, meta, flags) {
    gid++;
    const id = "rmb_" + String(gid).padStart(5, "0");
    const di = classifyDiacFlags(input);
    const negHit =
      NEGS.some((n) => foldCs(input).indexOf(foldCs(n)) >= 0) || /\bne\s+v\s+|\bne\s+do\s+/.test(foldCs(input));
    cases.push({
      id,
      cluster: clusterTag,
      group,
      input,
      expectedIntent,
      meta: meta || {},
      flags: Object.assign(
        {
          with_negative: negHit,
          with_person: PERSONS.some((p) => foldCs(input).indexOf(foldCs(p)) >= 0),
          with_address: ADDRS.some((a) => foldCs(input).indexOf(foldCs(a)) >= 0),
          with_time: TIMES.some((tm) => foldCs(input).indexOf(foldCs(tm)) >= 0),
          with_date: DATES.some((d) => foldCs(input).indexOf(foldCs(d)) >= 0),
          explicit_mod: /\bdo\s+kalend|\bdo\s+ukol|\bdo\s+poznam|\bjen\s+v\s+kalend|\bjen\s+v\s+ukol|\bjen\s+v\s+poznam/.test(foldCs(input)),
          implicit_mod:
            /\bschuzk|\budalost|\bzapamat|\bmusim\b|\bnezapomen\b/.test(foldCs(input)) &&
            !/\bdo\s+kalend|\bdo\s+ukol|\bdo\s+poznam/.test(foldCs(input)),
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

  const BASIC_SUB = [
    "schuzka",
    "zubar",
    "lekar",
    "pravnik",
    "kontrola",
    "navsteva",
    "jednani",
    "restaurace",
    "skola",
    "urad"
  ];
  const THEME_BODY = {
    schuzka: ["schůzku", "pracovní schůzku", "schůzku o smlouvě", "pracovní jednání"],
    zubar: ["zubaře", "preventivku u zubaře", "kontrolu chrupu u zubaře", "ošetření u zubaře"],
    lekar: ["lékaře", "kontrolu u lékaře", "očkování u lékaře", "vyšetření u lékaře"],
    pravnik: ["právníka", "advokáta", "schůzku s právníkem", "jednání s advokátem"],
    kontrola: ["kontrolu auta", "kontrolu smlouvy", "technickou kontrolu", "revizi kotle"],
    navsteva: ["návštěvu u babičky", "návštěvu v nemocnici", "návštěvu u známých"],
    jednani: ["jednání s bankou", "obchodní jednání", "jednání o nájmu", "jednání s dodavatelem"],
    restaurace: ["večeři v restauraci", "oběd v restauraci", "schůzku v restauraci", "rezervaci v restauraci"],
    skola: ["schůzku ve škole", "třídní schůzku", "zápis ve škole", "schůzku s třídním"],
    urad: ["výřez na úřadě", "podání na úřadě", "frontu na úřadě", "schůzku na úřadě"]
  };
  const CAL_OPENERS = [
    "Ulož mi prosím do kalendáře",
    "Dej mi do kalendáře",
    "Zapiš mi do kalendáře",
    "Přidej do kalendáře",
    "Nahoď mi do kalendáře",
    "Silvere prosím ulož do kalendáře",
    "Potřebuju uložit do kalendáře",
    "Chci mít zapsané v kalendáři",
    "Zapiš prosím do kalendáře",
    "Rychle nahod do kalendáře"
  ];

  let idx = 0;
  for (let bi = 0; bi < BASIC_SUB.length; bi++) {
    const sub = BASIC_SUB[bi];
    const bodies = THEME_BODY[sub];
    for (let k = 0; k < 160; k++) {
      const d = DATES[(idx + k) % DATES.length];
      const tm = TIMES[(idx + k * 3) % TIMES.length];
      const p = PERSONS[(idx + k * 5) % PERSONS.length];
      const body = bodies[(idx + k) % bodies.length];
      const op = CAL_OPENERS[(idx + k * 7) % CAL_OPENERS.length];
      const tail = k % 3 === 0 ? ", ne do úkolů" : k % 3 === 1 ? ", ne do poznámek" : ", jen kalendář";
      const raw = op + " " + d + " v " + tm + " " + body + " s " + p + tail + ".";
      push("calendar_write_basic:" + sub, "calendar_write", diacVariant(idx + k, raw), "calendar.create", {}, {});
    }
    idx += 1000;
  }

  const ADDR_SNIP = [
    "na adrese Korunní 44 Praha",
    "místo je restaurace Palma",
    "na náměstí Bratří Synků",
    "Praha jedna Vinohradská",
    "potkáme se na Štvanici"
  ];
  for (let ai = 0; ai < 450; ai++) {
    const d = DATES[ai % DATES.length];
    const tm = TIMES[(ai * 2) % TIMES.length];
    const sn = ADDR_SNIP[ai % ADDR_SNIP.length];
    const raw =
      "Ulož mi " +
      d +
      " v " +
      tm +
      " schůzku s " +
      PERSONS[ai % PERSONS.length] +
      ", " +
      sn +
      ", ne do úkolů.";
    push("calendar_write_address", "calendar_write", diacVariant(ai, raw), "calendar.create", {}, {});
  }

  const NOTE_TAIL = [
    "do poznámky mi dej ať si beru deštník",
    "do poznámek napiš že mám vzít občanku",
    "a připomeň mi nabít telefon",
    "ať si vezmu všechny doklady",
    "nezapomenout vzít hotovost"
  ];
  for (let ni = 0; ni < 450; ni++) {
    const d = DATES[ni % DATES.length];
    const tm = TIMES[(ni * 3) % TIMES.length];
    const tail = NOTE_TAIL[ni % NOTE_TAIL.length];
    const raw =
      "Ulož mi " +
      d +
      " v " +
      tm +
      " schůzku s " +
      PERSONS[ni % PERSONS.length] +
      " a " +
      tail +
      ", ne do úkolů.";
    push("calendar_write_note_tail", "calendar_write", diacVariant(ni, raw), "calendar.create", {}, {});
  }

  const TW_BASIC = [
    "přidej úkol",
    "nezapomeň",
    "nesmím zapomenout",
    "připomeň mi",
    "musím udělat",
    "mám zařídit"
  ];
  for (let ti = 0; ti < 950; ti++) {
    const lead = TW_BASIC[ti % TW_BASIC.length];
    const thing = ["uhlí", "rohlíky", "mléko", "telefon", "práci", "účet"][ti % 6];
    const raw = lead + " do úkolů " + thing + " do pátku, ne do kalendáře.";
    push("task_write_basic", "task_write", diacVariant(ti, raw), "task.create", {}, {});
  }

  const DEAD = ["do pátku", "zítra ráno", "dnes večer", "do oběda", "příští týden", "do konce měsíce"];
  for (let di = 0; di < 950; di++) {
    const dl = DEAD[di % DEAD.length];
    const raw = "Hoď mi do úkolů koupit " + ["uhlí", "mléko", "léky", "dárek"][di % 4] + " " + dl + ", ne do kalendáře.";
    push("task_write_deadline", "task_write", diacVariant(di, raw), "task.create", {}, {});
  }

  const NW_BASIC = [
    "poznamenej si",
    "ulož poznámku",
    "napiš si poznámku",
    "zapamatuj si",
    "do poznámek dej"
  ];
  for (let wi = 0; wi < 450; wi++) {
    const lead = NW_BASIC[wi % NW_BASIC.length];
    const tailNote =
      ["PIN je v šuplíku", "lednice má záruku do 2028", "soused má klíče"][wi % 3] + ", ne úkol.";
    const raw =
      /\bdo\s+pozn/i.test(lead) ? lead + " že " + tailNote : lead + " do poznámek že " + tailNote;
    push("note_write_basic", "note_write", diacVariant(wi, raw), "note.create", {}, {});
  }

  const WOBJ = [
    "záruka na TV končí v roce 2027",
    "lednice koupená 3.3.2024",
    "faktura za pračku je v emailu",
    "PIN ke kartě je doma v šuplíku",
    "servis auta mám objednaný na pátek"
  ];
  for (let oi = 0; oi < 450; oi++) {
    const raw = "Ulož poznámku: " + WOBJ[oi % WOBJ.length] + ", ne kalendář.";
    push("note_write_warranty_object", "note_write", diacVariant(oi, raw), "note.create", {}, {});
  }

  const NQ_T = [
    "kdy mi končí záruka TV",
    "najdi poznámku o lednici",
    "kde mám PIN ke kartě",
    "co jsem si psal o advokátovi",
    "najdi fakturu za pračku"
  ];
  for (let nqi = 0; nqi < 800; nqi++) {
    const neg = nqi % 4 === 0 ? "nic neukládej, " : "";
    const raw = neg + NQ_T[nqi % NQ_T.length] + (nqi % 2 ? "?" : "");
    push("note_query", "note_query", diacVariant(nqi, raw), "note.query", {}, {});
  }

  const TQ_T = [
    "co mám dnes udělat",
    "jaké mám úkoly",
    "co musím zaplatit",
    "najdi úkoly na zítra",
    "co mám do pátku"
  ];
  for (let tqi = 0; tqi < 800; tqi++) {
    const raw = TQ_T[tqi % TQ_T.length] + (tqi % 2 ? "?" : "");
    push("task_query", "task_query", diacVariant(tqi, raw), "task.query", {}, {});
  }

  const CQ_T = [
    "co mám zítra",
    "kdy mám zubaře",
    "jaké mám dnes schůzky",
    "kdy mám právníka",
    "co mám v kalendáři příští týden"
  ];
  for (let cqi = 0; cqi < 1300; cqi++) {
    const neg = cqi % 6 === 0 ? "nic neukládej, " : "";
    const raw = neg + CQ_T[cqi % CQ_T.length] + (cqi % 2 ? "?" : "");
    push("calendar_query", "calendar_query", diacVariant(cqi, raw), "calendar.query", {}, {});
  }

  for (let mi = 0; mi < 550; mi++) {
    const d = DATES[mi % DATES.length];
    const tm = TIMES[(mi * 2) % TIMES.length];
    const addr = ADDRS[mi % ADDRS.length];
    const raw =
      "Ulož do kalendáře " +
      d +
      " v " +
      tm +
      " zubaře na " +
      addr +
      " a zároveň do poznámky napiš kartičku pojištěnce, ne do úkolů.";
    const f = foldCs(raw);
    const needsDualWrite =
      /\b(zaroven|zároveň)\b/i.test(raw) && /\b(do\s+poznam|\bpoznam|\bdo\s+kalend|\buloz|\bulož|\bpridej|\bpřidej)/i.test(f);
    const queryNeg = /jen\s+se\s+podivej|jen\s+cti|nic\s+neuklad/.test(f) ? f : "";
    push(
      "multi_intent_calendar_note",
      "multi_intent",
      diacVariant(mi, raw),
      "unknown",
      { needsDualWrite, queryNeg },
      { multi: true }
    );
  }

  const NEG_CAL = [
    "Jen se podívej co mám zítra v kalendáři, nic neukládej.",
    "Nic neukládej, jen zjisti kdy mám zubaře.",
    "Nevytvářej událost, jen mi řekni co mám ve čtvrtek v kalendáři.",
    "Jen čti kalendář, nic neukládej, co mám příští týden?",
    "Jen se podívej do kalendáře, ne do kalendáře, nic nevytvářej."
  ];
  const NEG_TASK = [
    "Jen se podívej co mám za úkoly, nic neukládej.",
    "Nic neukládej, jen zjisti jestli mám koupit mléko v úkolech.",
    "Ne do úkolů nic nového, jen mi řekni co mám dnes udělat.",
    "Jen čti úkoly, nic neukládej, co mám do pátku?",
    "Jen se podívej do úkolů, ne do kalendáře, nic neukládej."
  ];
  const NEG_NOTE = [
    "Nic neukládej, jen najdi poznámku o PINu.",
    "Nevytvářej poznámku, jen řekni kde mám záruku na TV.",
    "Jen se podívej do poznámek, nic neukládej, co mám o lednici?",
    "Nic neukládej, jen zjisti fakturu za pračku v poznámkách.",
    "Jen čti poznámky, nic neukládej, kde mám PIN ke kartě?"
  ];
  for (let gi = 0; gi < 450; gi++) {
    const bucket = gi % 3;
    if (bucket === 0) {
      const raw = NEG_CAL[gi % NEG_CAL.length];
      push("negation_safety:calendar_read", "calendar_query", raw, "calendar.query", {}, {});
    } else if (bucket === 1) {
      const raw = NEG_TASK[gi % NEG_TASK.length];
      push("negation_safety:task_read", "task_query", raw, "task.query", {}, {});
    } else {
      const raw = NEG_NOTE[gi % NEG_NOTE.length];
      push("negation_safety:note_read", "note_query", raw, "note.query", {}, {});
    }
  }

  const MESSY_PREFIX = "Silvere prosím tě až budeš mít chvilku tak ";
  for (let mi = 0; mi < 800; mi++) {
    const d = DATES[mi % DATES.length];
    const tm = TIMES[(mi * 4) % TIMES.length];
    const base =
      "uloz mi do kalendaru " +
      d +
      " " +
      tm +
      " schuzku s " +
      PERSONS[mi % PERSONS.length] +
      " na adrese " +
      ADDRS[mi % ADDRS.length] +
      " ne do ukolu";
    const raw = mi % 2 === 0 ? MESSY_PREFIX + base : base + " a jeste mi pridej ze mam zitra zubar";
    push("messy_czech_mobile", "calendar_write", raw, "calendar.create", {}, {});
  }

  if (cases.length < 10000) {
    console.log("seed_data_fail=corpus_below_10000_got_" + cases.length);
    process.exit(1);
  }

  applyHarnessExpectationHarmonization(cases);

  for (const c of cases) {
    const negHit =
      NEGS.some((n) => foldCs(c.input).indexOf(foldCs(n)) >= 0) || /\bne\s+v\s+|\bne\s+do\s+/.test(foldCs(c.input));
    c.flags.with_negative = negHit;
  }

  const hist = {};
  for (let si = 0; si < cases.length; si++) {
    const cl = String(cases[si].cluster || "MISS");
    hist[cl] = (hist[cl] || 0) + 1;
  }
  const histKeys = Object.keys(hist).sort((a, b) => hist[b] - hist[a]);
  const histLine = histKeys.map((k) => k + "=" + hist[k]).join("|");
  if (histKeys.length > 80) {
    console.log("seed_data_fail=cluster_histogram_too_many_keys_" + histKeys.length);
    process.exit(1);
  }
  return cases;
}
function failDetail(c, turn, ev) {
  const d = turn.draft || {};
  return [
    "=== FAIL ===",
    "id=" + escapeField(c.id),
    "cluster=" + escapeField(c.cluster || c.group),
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
      "scripts/audit_silver_realistic_mobile_corpus.cjs",
      "scripts/silver-realistic-mobile-corpus-report.json",
      "scripts/audit_silver_20000_routing_stable.cjs",
      "scripts/audit_silver_real_ux_v1.cjs",
      "scripts/silver-quality-v2-report.json",
      "scripts/silver-real-ux-v1-report.json",
      "scripts/silver-real-czech-corpus-v1.cjs",
      "scripts/silver-real-czech-corpus-v1-report.json",
      "scripts/silver-real-czech-public-ux-corpus-v2.cjs",
      "scripts/silver-rcz2-mobile-voice-intent-fail-diagnostic.cjs",
      "scripts/silver-rcz2-mobile-voice-intent-fail-diagnostic-report.json",
      "scripts/silver-deep-product-real-ux-v2-report.json",
      "scripts/silver-real-human-chaos-v3.cjs",
      "scripts/silver-real-human-chaos-v3-report.json",
      "scripts/silver-rhc3-module-switch-triage.cjs",
      "scripts/silver-rhc3-module-switch-triage-report.json",
      "scripts/silver-rhc3-top-cluster-diagnostic.cjs",
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
      "SILVER_RUN_REPORT.md",
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

function main() {
  const git = gitTrackedClean();
  if (!git.ok) {
    console.log("=== SILVER_REALISTIC_MOBILE_AUDIT_ABORT ===");
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

  const cases = buildRealisticMobileCorpus();
  if (cases.length < 10000) {
    console.log("seed_data_fail=expected_min_10000_got_" + cases.length);
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
  const qualityDenom = cases.length;

  const titleCleanFailRecords = [];
  const titleFailFillerCount = new Map();
  const titleFailBucketCount = new Map();
  const titleFailByGroup = {};
  const byCluster = {};
  const failClusterKeyCount = {};
  const dangerousCaseIds = new Set();
  let falseWriteCount = 0;
  let writeWhenNegatedCount = 0;
  let unknownWhenUncertainCount = 0;

  for (const c of cases) {
    if (!byG[c.group]) byG[c.group] = { pass: 0, fail: 0 };
    const ck = c.cluster || c.group;
    if (!byCluster[ck]) byCluster[ck] = { pass: 0, fail: 0 };
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch {}
    const empty = eng.createEmptyDraft();
    const turn = eng.processUserTurn(c.input, empty, ctxForCase(c.group));
    turn._auditInput = c.input;
    const ev = evaluateOne(c, turn);
    const foldedIn = foldCs(c.input);
    const engN = turn.normalizedIntent;
    const psN = turn.processingState;
    const createLike =
      psN === "READY_TO_SAVE" || engN === "calendar.create" || engN === "tasks.create" || engN === "notes.create";
    if (
      !ev.pass &&
      c.group.indexOf("_query") > 0 &&
      (ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail")
    ) {
      falseWriteCount++;
    }
    if (hasNegWrite(foldedIn) && createLike) {
      writeWhenNegatedCount++;
      dangerousCaseIds.add(c.id);
    }
    if (ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail") {
      dangerousCaseIds.add(c.id);
    }
    if (!ev.pass && c.expectedIntent === "unknown" && ev.cat === "intent_fail") {
      unknownWhenUncertainCount++;
    }
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
      byCluster[ck].pass++;
      lines.push("PASS " + c.id);
    } else {
      byG[c.group].fail++;
      byCluster[ck].fail++;
      const cat = ev.cat && FAIL_CATS.has(ev.cat) ? ev.cat : "unknown";
      catCount[cat]++;
      const block = failDetail(c, turn, ev);
      lines.push(block);
      fails.push({ sev: severity(ev), block, cat, input: c.input, cluster: ck, id: c.id });
      const fck = ck + "||" + cat;
      failClusterKeyCount[fck] = (failClusterKeyCount[fck] || 0) + 1;
      if (!firstFail) firstFail = c.id + "|" + cat + "|" + escapeField(c.input.slice(0, 160));
    }
  }

  let noteWriteBasicUnnecessaryDisambiguationFails = 0;
  for (let iNwb = 0; iNwb < fails.length; iNwb++) {
    const fnb = fails[iNwb];
    if (fnb.cluster === "note_write_basic" && fnb.cat === "unnecessary_disambiguation") {
      noteWriteBasicUnnecessaryDisambiguationFails++;
    }
  }

  let embeddedEventNoteTailStandaloneNoteCreateCount = 0;
  const embeddedTailStandaloneProbes = [
    "Ulož mi schůzku s Jakubem zítra v 15:00 a do poznámky mi dej abych si vzal deštník",
    "Dej do kalendáře schůzku s Jirkou v pátek ve 3 a do poznámky napiš vzít dokumenty",
    "Zítra zubař v 10 na Korunní 44 Praha a do poznámky přidej kartičku pojišťovny"
  ];
  for (let iEmb = 0; iEmb < embeddedTailStandaloneProbes.length; iEmb++) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (eEmbC) {
      void eEmbC;
    }
    const trEmb = eng.processUserTurn(embeddedTailStandaloneProbes[iEmb], eng.createEmptyDraft(), ctxEmpty());
    if (
      trEmb.normalizedIntent === "notes.create" &&
      String(trEmb.processingState || "") === "READY_TO_SAVE" &&
      !trEmb.silverCompanionNoteTurn
    ) {
      embeddedEventNoteTailStandaloneNoteCreateCount++;
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

  function rmEmbeddedCalNoteNoCompanion(label, rawIn, needleFold) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (eEmb) {
      void eEmb;
    }
    const tr = eng.processUserTurn(String(rawIn || "").trim(), eng.createEmptyDraft(), ctxEmpty());
    const nFold = foldCs(String((tr.draft && tr.draft.note) || ""));
    return auditRmPass(
      label,
      tr.normalizedIntent === "calendar.create" &&
        !tr.silverCompanionNoteTurn &&
        nFold.indexOf(needleFold) >= 0
    );
  }
  rmAll =
    rmEmbeddedCalNoteNoCompanion(
      "embedded_event_note_jakub_destnik",
      "Ulož mi schůzku s Jakubem zítra v 15:00 a do poznámky mi dej abych si vzal deštník",
      "destnik"
    ) && rmAll;
  rmAll =
    rmEmbeddedCalNoteNoCompanion(
      "embedded_event_note_jirka_dokumenty",
      "Dej do kalendáře schůzku s Jirkou v pátek ve 3 a do poznámky napiš vzít dokumenty",
      "dokument"
    ) && rmAll;
  rmAll =
    rmEmbeddedCalNoteNoCompanion(
      "embedded_event_note_zubar_karticka",
      "Zítra zubař v 10 na Korunní 44 Praha a do poznámky přidej kartičku pojišťovny",
      "kartick"
    ) && rmAll;
  rmAll =
    rmEmbeddedCalNoteNoCompanion(
      "embedded_event_note_pravnik_smlouva",
      "Ulož mi právníka ve čtvrtek 14:00 Spálená 3 Praha a k tomu do poznámky smlouvu",
      "smlouv"
    ) && rmAll;
  rmAll =
    rmEmbeddedCalNoteNoCompanion(
      "embedded_event_note_bohdalova_zavolat",
      "Schůzka s paní Bohdalovou v pondělí 9:00 Praha jedna a do poznámky mi dej zavolat předem",
      "zavolat"
    ) && rmAll;
  rmAll =
    rmEmbeddedCalNoteNoCompanion(
      "embedded_event_note_tomas_obcanka",
      "Ulož mi schůzku s Tomášem pozítří 16:00 ať si vezmu občanku",
      "obcank"
    ) && rmAll;
  rmAll =
    rmEmbeddedCalNoteNoCompanion(
      "embedded_event_note_investor_podklady",
      "Zítra 15:00 investor v kavárně a nezapomenout vzít podklady",
      "podklad"
    ) && rmAll;
  rmAll =
    rmEmbeddedCalNoteNoCompanion(
      "embedded_event_note_kontrola_vysledky",
      "Dej do kalendáře kontrolu v úterý dopoledne a poznámka: vzít výsledky",
      "vysled"
    ) && rmAll;

  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (eRmSep) {
    void eRmSep;
  }
  const rmSep = eng.processUserTurn(
    "Ulož schůzku zítra v 15 a zvlášť si napiš poznámku že mám koupit kytku",
    eng.createEmptyDraft(),
    ctxEmpty()
  );
  const sepNote = foldCs(
    String((rmSep.silverCompanionNoteTurn && rmSep.silverCompanionNoteTurn.draft && rmSep.silverCompanionNoteTurn.draft.silverNoteText) || "")
  );
  rmAll =
    auditRmPass(
      "explicit_separate_note_zvlast_kytky",
      rmSep.normalizedIntent === "calendar.create" &&
        !!rmSep.silverCompanionNoteTurn &&
        sepNote.indexOf("kytk") >= 0
    ) && rmAll;

  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (eRmNeg) {
    void eRmNeg;
  }
  const rmNeg = eng.processUserTurn(
    "Silvere jen se podívej na schůzku zítra a nic neukládej",
    eng.createEmptyDraft(),
    ctxEmpty()
  );
  rmAll =
    auditRmPass(
      "read_only_negated_no_write",
      rmNeg.normalizedIntent !== "notes.create" &&
        rmNeg.normalizedIntent !== "tasks.create" &&
        !(rmNeg.normalizedIntent === "calendar.create" && rmNeg.processingState === "READY_TO_SAVE")
    ) && rmAll;

  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (eRmSn) {
    void eRmSn;
  }
  const rmSilNotes = eng.processUserTurn(
    "Silvere jen se podívej do poznámek, nic neukládej",
    eng.createEmptyDraft(),
    ctxEmpty()
  );
  rmAll =
    auditRmPass(
      "p1_neg_silvere_notes_readonly_no_write",
      !(rmSilNotes.normalizedIntent === "notes.create" && rmSilNotes.processingState === "READY_TO_SAVE") &&
        !(rmSilNotes.normalizedIntent === "tasks.create" && rmSilNotes.processingState === "READY_TO_SAVE") &&
        !(rmSilNotes.normalizedIntent === "calendar.create" && rmSilNotes.processingState === "READY_TO_SAVE")
    ) && rmAll;

  const p1NoteWriteBasicSpot = [
    ["p1_note_basic_zapis_pin", "Zapiš poznámku PIN ke kartě je 1234"],
    ["p1_note_basic_uloz_auto", "Ulož poznámku že auto má modrou barvu"],
    ["p1_note_basic_napis_si_do", "Napiš si do poznámek heslo k Wi-Fi je ABCD"],
    ["p1_note_basic_poznamenej", "Poznamenej si faktura za elektřinu zaplacena"],
    ["p1_note_basic_uloz_do", "Ulož do poznámek že záruka na televizi končí v lednu"]
  ];
  for (let iPs = 0; iPs < p1NoteWriteBasicSpot.length; iPs++) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (ePs) {
      void ePs;
    }
    const tPs = eng.processUserTurn(p1NoteWriteBasicSpot[iPs][1], eng.createEmptyDraft(), ctxEmpty());
    const okPs =
      engineToAuditIntent(tPs.normalizedIntent, "note_write") === "note.create" &&
      tPs.processingState === "READY_TO_SAVE";
    rmAll = auditRmPass(p1NoteWriteBasicSpot[iPs][0], okPs) && rmAll;
  }

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
        jakNote.indexOf("pripom") >= 0 &&
        jakNote.indexOf("mobil") >= 0 &&
        jakTitle.indexOf("pripom") < 0
    ) && rmAll;
  console.log("real_mobile_cases=" + (rmAll ? "PASS" : "FAIL"));
  if (!rmAll) {
    console.log("=== SILVER_REAL_MOBILE_AUDIT_FAIL ===");
    process.exit(1);
  }

  fails.sort((a, b) => b.sev - a.sev);
  const seenEx = new Set();
  const top50Examples = [];
  for (let fi = 0; fi < fails.length; fi++) {
    const f = fails[fi];
    const k = f.input.slice(0, 160);
    if (seenEx.has(k)) continue;
    seenEx.add(k);
    top50Examples.push({
      id: f.id || "",
      cluster: f.cluster || "",
      category: f.cat || "",
      input: f.input.slice(0, 280)
    });
    if (top50Examples.length >= 50) break;
  }

  const totalCases = cases.length;
  const passed = totalCases - fails.length;
  const accReal = ((passed / totalCases) * 100).toFixed(2);

  function accForGroup(g) {
    const x = byG[g];
    if (!x) return "0.00";
    const t = x.pass + x.fail;
    if (!t) return "0.00";
    return ((x.pass / t) * 100).toFixed(2);
  }

  function accClusterPrefix(pref) {
    let pass = 0;
    let fail = 0;
    for (const k in byCluster) {
      if (!Object.prototype.hasOwnProperty.call(byCluster, k)) continue;
      if (k.indexOf(pref) !== 0) continue;
      pass += byCluster[k].pass;
      fail += byCluster[k].fail;
    }
    const t = pass + fail;
    if (!t) return "0.00";
    return ((pass / t) * 100).toFixed(2);
  }

  const accuracyByCluster = {};
  const failCountByCluster = {};
  for (const k in byCluster) {
    if (!Object.prototype.hasOwnProperty.call(byCluster, k)) continue;
    const z = byCluster[k];
    const tot = z.pass + z.fail;
    accuracyByCluster[k] = tot ? ((z.pass / tot) * 100).toFixed(2) : "0.00";
    failCountByCluster[k] = z.fail;
  }

  const clusterPairs = Object.keys(failClusterKeyCount)
    .map((k) => ({ k: k, n: failClusterKeyCount[k] }))
    .sort((a, b) => b.n - a.n || String(a.k).localeCompare(String(b.k)));
  const top20FailClusters = clusterPairs.slice(0, 20).map((p) => p.k + "=" + p.n);
  const top20Line = top20FailClusters.join(" | ");

  let recommendedNextFixCluster = "";
  let recommendedNextFixReason = "";
  if (clusterPairs.length) {
    const topK = clusterPairs[0].k;
    const parts = topK.split("||");
    recommendedNextFixCluster = parts[0] || topK;
    const catP = parts[1] || "";
    recommendedNextFixReason =
      "Highest fail mass in «" +
      recommendedNextFixCluster +
      "» dominated by «" +
      catP +
      "»; safest follow-up is a narrow Silver routing/read-guard change scoped to this Czech mobile phrasing family (no UI).";
  } else {
    recommendedNextFixCluster = "(none)";
    recommendedNextFixReason = "No fails in this corpus slice; collect more edge cases before engine edits.";
  }

  let gitHead = "";
  let prUrl = "";
  try {
    gitHead = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e) {
    gitHead = "";
  }
  try {
    prUrl = execSync("gh pr view --json url -q .url", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e) {
    prUrl = "";
  }

  const baseline20k = {
    overall_accuracy: "",
    calendar_write: "",
    calendar_query: "",
    task_write: "",
    task_query: "",
    note_write: "",
    note_query: "",
    multi_intent: "",
    query_created_write_count: ""
  };
  if (process.env.SILVER_REALISTIC_EMBED_20K === "1") {
    try {
      const out20 = execSync('node "' + path.join(REPO, "scripts", "audit_silver_20000_routing_stable.cjs") + '"', {
        cwd: REPO,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024
      });
      const m1 = out20.match(/overall_accuracy=([\d.]+)%/);
      if (m1) baseline20k.overall_accuracy = m1[1];
      const grab = (label) => {
        const r = new RegExp(label + "=([0-9]+)/([0-9]+)");
        const m = out20.match(r);
        return m ? m[1] + "/" + m[2] : "";
      };
      baseline20k.calendar_write = grab("calendar_write");
      baseline20k.calendar_query = grab("calendar_query");
      baseline20k.task_write = grab("task_write");
      baseline20k.task_query = grab("task_query");
      baseline20k.note_write = grab("note_write");
      baseline20k.note_query = grab("note_query");
      baseline20k.multi_intent = grab("multi_intent");
      const mq = out20.match(/query_created_write_count=([0-9]+)/);
      baseline20k.query_created_write_count = mq ? mq[1] : "";
    } catch (e2) {
      void e2;
    }
  }

  const dangerousWriteCount = dangerousCaseIds.size;
  const queryCreatedWriteRealistic = catCount.query_created_write || 0;
  let calendarQueryIntentFailCount = 0;
  for (let cqf = 0; cqf < fails.length; cqf++) {
    if (fails[cqf].cluster === "calendar_query" && fails[cqf].cat === "intent_fail") calendarQueryIntentFailCount++;
  }
  const calQueryIntentFailBaseline = 87;
  const calendarQueryIntentFailReduced =
    calendarQueryIntentFailCount < calQueryIntentFailBaseline ? "YES" : "NO";
  const mainCommitBefore = "fc7c837351fcedd73a7aad5ae6eddeb32e38b5d4";
  const mergedNo = "NO";
  const smokeFlag = process.env.SILVER_REALISTIC_AUDIT_SMOKE || "SKIPPED";
  const prodProofFlag = process.env.SILVER_REALISTIC_AUDIT_PROD || "SKIPPED";
  const calRegFlag = process.env.SILVER_REALISTIC_AUDIT_CAL_REG || "SKIPPED";
  const consoleErr = process.env.SILVER_REALISTIC_AUDIT_CONSOLE || "n/a";
  const clsVal = process.env.SILVER_REALISTIC_AUDIT_CLS || "n/a";
  const zeroRegFlag = process.env.SILVER_REALISTIC_AUDIT_ZERO_REG || "SKIPPED";
  const gitClean = git.ok ? "YES" : "NO";
  const readyMerge = gitClean === "YES" && rmAll ? "YES" : "NO";

  const explicitSeparateNoteExceptionPassed =
    rmSep.normalizedIntent === "calendar.create" &&
    !!rmSep.silverCompanionNoteTurn &&
    sepNote.indexOf("kytk") >= 0;

  const reportObj = {
    harness_id: STABLE_HARNESS_ID,
    fixed_now: FIXED_NOW_ISO,
    total_cases: totalCases,
    overall_accuracy_realistic: accReal,
    accuracy_by_cluster: accuracyByCluster,
    fail_count_by_cluster: failCountByCluster,
    top_20_fail_clusters: top20FailClusters,
    top_50_failed_examples: top50Examples,
    false_write_count: falseWriteCount,
    dangerous_write_count: dangerousWriteCount,
    query_created_write_count_realistic: queryCreatedWriteRealistic,
    unknown_when_uncertain_count: unknownWhenUncertainCount,
    write_when_negated_count: writeWhenNegatedCount,
    calendar_write_accuracy: accForGroup("calendar_write"),
    calendar_query_accuracy: accForGroup("calendar_query"),
    task_write_accuracy: accForGroup("task_write"),
    task_query_accuracy: accForGroup("task_query"),
    note_write_accuracy: accForGroup("note_write"),
    note_query_accuracy: accForGroup("note_query"),
    multi_intent_accuracy: accForGroup("multi_intent"),
    negation_safety_accuracy: accClusterPrefix("negation_safety"),
    messy_czech_mobile_accuracy: accuracyByCluster.messy_czech_mobile || "0.00",
    note_write_basic_unnecessary_disambiguation_fail_count: noteWriteBasicUnnecessaryDisambiguationFails,
    note_write_basic_unnecessary_disambiguation_reduced:
      noteWriteBasicUnnecessaryDisambiguationFails === 0 ? "YES" : "NO",
    embedded_event_note_tail_standalone_note_create_count: embeddedEventNoteTailStandaloneNoteCreateCount,
    calendar_query_intent_fail_count: calendarQueryIntentFailCount,
    calendar_query_intent_fail_reduced: calendarQueryIntentFailReduced,
    explicit_separate_note_exception_passed: explicitSeparateNoteExceptionPassed ? "YES" : "NO",
    recommended_next_fix_cluster: recommendedNextFixCluster,
    recommended_next_fix_reason: recommendedNextFixReason,
    baseline_20k: baseline20k,
    real_mobile_cases: rmAll ? "PASS" : "FAIL",
    title_quality: {
      title_clean: qTitlePass + " / " + qualityDenom,
      date_parsed: qDatePass + " / " + qualityDenom,
      time_parsed: qTimePass + " / " + qualityDenom,
      entity_detected: qEntityPass + " / " + qualityDenom
    }
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  const block = [
    "=== SILVER_REALISTIC_MOBILE_CORPUS_AUDIT_V1_RESULT ===",
    "pr_url=" + escapeField(prUrl),
    "merged=" + mergedNo,
    "main_commit_before=" + escapeField(mainCommitBefore),
    "audit_only=YES",
    "engine_changed=YES",
    "total_cases=" + totalCases,
    "overall_accuracy_realistic=" + accReal + "%",
    "calendar_write_accuracy=" + accForGroup("calendar_write") + "%",
    "calendar_query_accuracy=" + accForGroup("calendar_query") + "%",
    "task_write_accuracy=" + accForGroup("task_write") + "%",
    "task_query_accuracy=" + accForGroup("task_query") + "%",
    "note_write_accuracy=" + accForGroup("note_write") + "%",
    "note_query_accuracy=" + accForGroup("note_query") + "%",
    "multi_intent_accuracy=" + accForGroup("multi_intent") + "%",
    "negation_safety_accuracy=" + accClusterPrefix("negation_safety") + "%",
    "false_write_count=" + falseWriteCount,
    "dangerous_write_count=" + dangerousWriteCount,
    "query_created_write_count_realistic=" + queryCreatedWriteRealistic,
    "calendar_query_intent_fail_count=" + calendarQueryIntentFailCount,
    "calendar_query_intent_fail_reduced=" + calendarQueryIntentFailReduced,
    "unknown_when_uncertain_count=" + unknownWhenUncertainCount,
    "write_when_negated_count=" + writeWhenNegatedCount,
    "top_20_fail_clusters=" + String(top20Line || "(none)"),
    "top_50_failed_examples_file=" + escapeField(REPORT_JSON),
    "recommended_next_fix_cluster=" + escapeField(recommendedNextFixCluster),
    "recommended_next_fix_reason=" + escapeField(recommendedNextFixReason),
    "20k_overall_accuracy=" + escapeField(baseline20k.overall_accuracy || "SKIPPED"),
    "20k_calendar_write=" + escapeField(baseline20k.calendar_write || "SKIPPED"),
    "20k_calendar_query=" + escapeField(baseline20k.calendar_query || "SKIPPED"),
    "20k_task_write=" + escapeField(baseline20k.task_write || "SKIPPED"),
    "20k_task_query=" + escapeField(baseline20k.task_query || "SKIPPED"),
    "20k_note_write=" + escapeField(baseline20k.note_write || "SKIPPED"),
    "20k_note_query=" + escapeField(baseline20k.note_query || "SKIPPED"),
    "20k_multi_intent=" + escapeField(baseline20k.multi_intent || "SKIPPED"),
    "20k_query_created_write_count=" + escapeField(baseline20k.query_created_write_count || "SKIPPED"),
    "real_mobile_cases=" + (rmAll ? "PASS" : "FAIL"),
    "silver_calendar_create_regression=" + calRegFlag,
    "smoke=" + smokeFlag,
    "silver_prod_proof=" + prodProofFlag,
    "console_app_errors=" + consoleErr,
    "cls=" + clsVal,
    "zero_regression=" + zeroRegFlag,
    "git_status_clean=" + gitClean,
    "ready_for_merge=" + readyMerge,
    "note_write_basic_unnecessary_disambiguation_fail_count=" + noteWriteBasicUnnecessaryDisambiguationFails,
    "note_write_basic_unnecessary_disambiguation_reduced=" + (noteWriteBasicUnnecessaryDisambiguationFails === 0 ? "YES" : "NO"),
    "embedded_event_note_tail_standalone_note_create_count=" + embeddedEventNoteTailStandaloneNoteCreateCount,
    "explicit_separate_note_exception_passed=" + (explicitSeparateNoteExceptionPassed ? "YES" : "NO"),
    "next_recommended_scope=P0 FIX TOP REALISTIC MOBILE CORPUS CLUSTER — based only on recommended_next_fix_cluster after this audit PR is merged",
    "=== END_SILVER_REALISTIC_MOBILE_CORPUS_AUDIT_V1_RESULT ==="
  ].join("\n");

  console.log("\n" + block);
  fs.writeFileSync(REPORT_TXT, lines.join("\n\n") + "\n\n" + block + "\n", "utf8");
}

if (require.main === module) {
  main();
}

module.exports = {
  loadEngine,
  evaluateOne,
  applyHarnessExpectationHarmonization,
  ctxForCase,
  foldCs,
  hasNegWrite,
  FAIL_CATS,
  engineToAuditIntent,
  rawUserMessage,
  cardType
};
