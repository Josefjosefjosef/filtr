/**
 * Silver Quality Audit V2 — foundation (non-blocking baseline).
 * Measures output quality beyond routing; may report FAIL clusters without failing CI merge gates.
 * Loads iuSilverCalendarEngine from assets/app.js (READ ONLY bundle markers).
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HARNESS_ID = "audit_silver_quality_v2_foundation";
const FIXED_NOW_ISO = "2026-05-04T12:00:00";
const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-quality-v2-report.json");

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

function buildSeed() {
  const events = [
    { id: "e_petr", date: ZITRA, time: "15:00", title: "Schůzka s Petrem", address: "", note: "probrat smlouvu" },
    { id: "e_tomas", date: TODAY, time: "10:15", title: "Schůzka s Tomášem", address: "", note: "rychlá kontrola dokumentů" },
    { id: "e_zubar", date: ZITRA, time: "15:00", title: "Zubař", address: "Korunní 33 Praha", note: "vzít kartičku pojištěnce" },
    { id: "e_pravnik", date: TODAY, time: "18:00", title: "Právník", address: "Praha 1", note: "vzít smlouvu" },
    { id: "e_pavel", date: POZITRI, time: "16:00", title: "Schůzka s Pavlem", address: "", note: "domluvit termín" },
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
    { id: "n5", title: "Mariana", content: "Mariana má červenou tašku", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }
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

function ctxForRoutingGroup(g) {
  if (String(g || "").indexOf("query") >= 0 || g === "multi_intent") return ctxQuery();
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

function titleHasPollutionFolded(foldedTitle) {
  const ft = String(foldedTitle || "");
  const hits = [];
  if (/\bhod\s+mi\b/.test(ft)) hits.push("hod_mi");
  if (/\bdej\s+(mi\s+)?do\s+kalend/.test(ft)) hits.push("dej_do_kalendare");
  if (/\buloz\s+mi\b/.test(ft)) hits.push("uloz_mi");
  if (/\bpripomen\s+mi\b/.test(ft)) hits.push("pripomen_mi");
  if (/\bze\s+[^s]/.test(ft) || /\s+ze\s+v\s+/.test(ft)) hits.push("ze_filler_in_title");
  return hits;
}

function routingPassForCase(c, turn) {
  const folded = foldCs(c.input);
  let expected = c.expectedIntent;
  if (c.routingGroup === "calendar_write") {
    const ov = calendarWriteHarnessIntentOverride(folded);
    if (ov) expected = ov;
  }
  const auditIntent = engineToAuditIntent(turn.normalizedIntent, c.routingGroup);
  if (c.allowAuditIntents && c.allowAuditIntents.length) {
    return c.allowAuditIntents.indexOf(auditIntent) >= 0;
  }
  if (c.forbidWriteIntent) {
    if (auditIntent === "calendar.create" || auditIntent === "task.create" || auditIntent === "note.create") {
      if (createLikeTurn(turn)) return false;
    }
    return true;
  }
  if (expected === "flexible_query") {
    const cl = createLikeTurn(turn);
    return !cl;
  }
  if (auditIntent === "unknown" || turn.normalizedIntent === "clarification") {
    if (expected === "unknown") return true;
    if (c.treatUnknownAsPass) return true;
    return false;
  }
  return auditIntent === expected;
}

function evaluateFieldQualityCalendarWrite(turn) {
  const d = turn.draft || {};
  const raw = rawUserMessage(turn);
  if (turn.processingState === "STORAGE_DISAMBIGUATION") return { ok: false, tag: "unnecessary_disambiguation" };
  if (turn.normalizedIntent === "calendar.read" && turn.processingState === "READ_OK") return { ok: true, tag: "" };
  if (!raw || raw.length < 6) return { ok: false, tag: "raw_response_empty" };
  const ok =
    turn.processingState === "READY_TO_SAVE" ||
    turn.processingState === "NEEDS_CLARIFICATION" ||
    turn.processingState === "DRAFTING" ||
    /kalend|udalost|schuzk|uloz|prid/i.test(raw);
  return ok ? { ok: true, tag: "" } : { ok: false, tag: "raw_response_wrong" };
}

function evaluateFieldQualityTaskWrite(turn) {
  const raw = rawUserMessage(turn);
  if (turn.processingState === "STORAGE_DISAMBIGUATION") return { ok: false, tag: "unnecessary_disambiguation" };
  if (!raw || raw.length < 5) return { ok: false, tag: "raw_response_empty" };
  const ok =
    /ukol|uloz|prid|hotov|seznam|neproved|upresn/i.test(raw) || turn.processingState === "READY_TO_SAVE";
  return ok ? { ok: true, tag: "" } : { ok: false, tag: "raw_response_wrong" };
}

function evaluateFieldQualityNoteWrite(turn) {
  const raw = rawUserMessage(turn);
  if (turn.processingState === "STORAGE_DISAMBIGUATION") return { ok: false, tag: "unnecessary_disambiguation" };
  if (!raw || raw.length < 5) return { ok: false, tag: "raw_response_empty" };
  const ok = /poznam|uloz|zapamat|informac/i.test(raw) || turn.processingState === "READY_TO_SAVE";
  return ok ? { ok: true, tag: "" } : { ok: false, tag: "raw_response_wrong" };
}

function evaluateQuerySemantic(group, turn, foldedInput) {
  const raw = rawUserMessage(turn);
  const eng = turn.normalizedIntent;
  if (turn.processingState === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create") {
    return { ok: false, tag: "query_created_write" };
  }
  if (group === "task_query") {
    if (eng === "calendar.read" || eng === "calendar.create" || eng === "notes.read" || eng === "notes.create") {
      return { ok: false, tag: "query_wrong_dataset" };
    }
    if (!raw || raw.length < 8) return { ok: false, tag: "raw_response_empty" };
    if (/\brohlik/.test(foldedInput) && /\bschuzk|\budalost|\bkalend/.test(foldCs(raw))) return { ok: false, tag: "query_wrong_dataset" };
  }
  if (group === "note_query") {
    if (eng === "calendar.read" || eng === "calendar.create" || eng === "tasks.read" || eng === "tasks.create") {
      return { ok: false, tag: "query_wrong_dataset" };
    }
    if (!raw || raw.length < 6) return { ok: false, tag: "raw_response_empty" };
  }
  if (group === "calendar_query") {
    if (turn.processingState === "READY_TO_SAVE" || eng === "calendar.create") {
      return { ok: false, tag: "query_created_write" };
    }
    if (!raw || raw.length < 8) return { ok: false, tag: "raw_response_empty" };
  }
  return { ok: true, tag: "" };
}

function buildCorpus() {
  const cases = [];
  let nid = 0;
  function push(obj) {
    nid++;
    cases.push(Object.assign({ id: "qv2_" + String(nid).padStart(5, "0") }, obj));
  }

  const persons = ["Monikou", "Petrou", "Jakubem", "Tomášem", "Pavlem", "Marianou", "Petrem", "Jirkou"];
  const days = ["v sobotu", "v neděli", "v pondělí", "v úterý", "ve středu", "ve čtvrtek", "v pátek", "zítra", "pozítří"];
  const times = ["v 9", "v 9:00", "v 15", "v 15:00", "ve 3", "v 10:30", "v 18:00"];

  for (let i = 0; i < 40; i++) {
    const raw =
      "Hoď mi do kalendáře že " +
      days[i % days.length] +
      " " +
      times[i % times.length] +
      " mám schůzku s " +
      persons[i % persons.length] +
      ", jen kalendář.";
    push({
      cluster: "title_pollution_detection",
      routingGroup: "calendar_write",
      input: raw,
      expectedIntent: "calendar.create",
      routingGroupForSemantic: "calendar_write",
      checks: { titlePollution: true, fieldCalendar: true }
    });
  }

  for (let i = 0; i < 16; i++) {
    const raw =
      "Dej do kalendáře " +
      days[i % days.length] +
      " " +
      times[i % times.length] +
      " schůzku s " +
      persons[i % persons.length] +
      ", ne do úkolů.";
    push({
      cluster: "title_pollution_detection",
      routingGroup: "calendar_write",
      input: raw,
      expectedIntent: "calendar.create",
      checks: { titlePollution: true, fieldCalendar: true }
    });
  }

  const addrBodies = [
    "Schůzka s Petrou v pondělí 9:00 na Mánesově mostě v Praze",
    "Schůzka s Jakubem ve čtvrtek v 11 na Václavském náměstí 1 Praha",
    "Jednání s Pavlem zítra v 15:00 na Karlově mostě",
    "Schůzka s Monikou v pátek v 10 na Hlavním nádraží Praha",
    "Oběd s Tomášem dnes v 12:30 v centru Brna na náměstí Svobody"
  ];
  for (let i = 0; i < 30; i++) {
    const base = addrBodies[i % addrBodies.length];
    push({
      cluster: "address_location_detection",
      routingGroup: "calendar_write",
      input: base + ", jen kalendář.",
      expectedIntent: "calendar.create",
      checks: { addressNotOnlyInTitle: true, fieldCalendar: true }
    });
  }

  const emb = [
    ["Ulož schůzku zítra v 15 a do poznámky dej vzít smlouvu", "smlouv"],
    ["Zítra v 16 schůzka s Petrem a do poznámky napiš kartičku pojištěnce", "kartick"],
    ["Dej do kalendáře schůzku s Jirkou v pátek ve 3 a do poznámky napiš vzít dokumenty", "dokument"],
    ["Ulož mi schůzku s Jakubem zítra v 15:00 a do poznámky mi dej abych si vzal deštník", "destnik"]
  ];
  for (let e = 0; e < emb.length; e++) {
    for (let r = 0; r < 4; r++) {
      push({
        cluster: "embedded_event_note_quality",
        routingGroup: "calendar_write",
        input: emb[e][0],
        expectedIntent: "calendar.create",
        checks: { embeddedNoteNeedle: emb[e][1], forbidStandaloneNote: true, fieldCalendar: true }
      });
    }
  }

  const calW = [];
  const calOpen = ["Ulož mi do kalendáře", "Zapiš do kalendáře", "Přidej do kalendáře", "Naplánuj v kalendáři"];
  const calThing = ["schůzku s lékařem", "zubaře", "právníka", "kontrolu auta", "jednání v bance", "schůzku ve škole"];
  for (let i = 0; i < 72; i++) {
    const raw =
      calOpen[i % calOpen.length] +
      " " +
      days[i % days.length] +
      " " +
      times[i % times.length] +
      " " +
      calThing[i % calThing.length] +
      ", ne do úkolů.";
    calW.push(raw);
  }
  for (let i = 0; i < calW.length; i++) {
    push({
      cluster: "calendar_write_quality",
      routingGroup: "calendar_write",
      input: calW[i],
      expectedIntent: "calendar.create",
      checks: { titlePollution: true, fieldCalendar: true }
    });
  }

  const tw = [];
  const twLead = ["přidej úkol", "nezapomeň", "nesmím zapomenout", "připomeň mi", "musím udělat"];
  const twBody = ["koupit rohlíky", "koupit mléko", "zavolat doktorovi", "zaplatit nájem", "objednat pizzu", "vrátit knihu"];
  for (let i = 0; i < 60; i++) {
    tw.push(twLead[i % twLead.length] + " do úkolů " + twBody[i % twBody.length] + " do pátku, ne do kalendáře.");
  }
  for (let i = 0; i < tw.length; i++) {
    push({
      cluster: "task_write_quality",
      routingGroup: "task_write",
      input: tw[i],
      expectedIntent: "task.create",
      checks: { fieldTask: true }
    });
  }

  const nwLead = ["Ulož poznámku", "Zapiš si do poznámek", "Poznamenej si"];
  const nwBody = ["že PIN je v šuplíku", "že lednice má záruku do 2028", "že soused má klíče"];
  for (let i = 0; i < 45; i++) {
    push({
      cluster: "note_write_quality",
      routingGroup: "note_write",
      input: nwLead[i % nwLead.length] + " " + nwBody[i % nwBody.length] + ", ne kalendář.",
      expectedIntent: "note.create",
      checks: { fieldNote: true }
    });
  }

  const cq = [
    "co mám zítra",
    "jaké mám dnes schůzky",
    "kdy mám zubaře",
    "kdy mám právníka",
    "co mám v kalendáři příští týden",
    "mám něco ve čtvrtek odpoledne"
  ];
  for (let i = 0; i < 48; i++) {
    push({
      cluster: "calendar_query_quality",
      routingGroup: "calendar_query",
      input: cq[i % cq.length] + (i % 2 ? "?" : ""),
      expectedIntent: "calendar.query",
      checks: { querySemantic: true }
    });
  }

  const tq = [
    "co mám dnes za úkoly",
    "jaké mám úkoly",
    "najdi úkol rohlíky",
    "co musím zaplatit",
    "úkoly do pátku"
  ];
  for (let i = 0; i < 48; i++) {
    const inp = tq[i % tq.length] + (i % 2 ? "?" : "");
    const isRoh = /\brohlík/i.test(inp);
    push({
      cluster: "task_query_quality",
      routingGroup: "task_query",
      input: inp,
      expectedIntent: "task.query",
      checks: Object.assign({ querySemantic: true }, isRoh ? { retrievalNarrow: "rohlík" } : {})
    });
  }

  const nq = [
    "kdy mi končí záruka TV",
    "najdi poznámku o lednici",
    "kde mám PIN ke kartě",
    "co jsem si psal o advokátovi",
    "najdi fakturu za pračku"
  ];
  for (let i = 0; i < 40; i++) {
    push({
      cluster: "note_query_quality",
      routingGroup: "note_query",
      input: nq[i % nq.length] + (i % 2 ? "?" : ""),
      expectedIntent: "note.query",
      checks: { querySemantic: true }
    });
  }

  const safety = [
    "Silvere jen se podívej na schůzku zítra a nic neukládej",
    "Jen čti co mám zítra v kalendáři a nic neukládej",
    "Nic neukládej, jen zjisti jestli mám dnes úkol na nákup",
    "Nevytvářej událost, jen řekni co mám odpoledne",
    "Pouze čti poznámky o PINu, nic neukládej"
  ];
  for (let i = 0; i < 36; i++) {
    push({
      cluster: "safety_quality",
      routingGroup: i % 3 === 0 ? "calendar_query" : i % 3 === 1 ? "task_query" : "note_query",
      input: safety[i % safety.length],
      expectedIntent: "flexible_query",
      forbidWriteIntent: true,
      checks: { safetyNoWrite: true }
    });
  }

  const norm = [
    ["Ulož mi schůzku Praha jedna zítra v 15", "praha"],
    ["Schůzka ve tři zítra s právníkem", "prav"],
    ["Po obědě schůzka s účetní", "ucetn"],
    ["zejtra zubař v 10", "zubar"],
    ["ve středu ve tři advokát", "advok"]
  ];
  for (let i = 0; i < 30; i++) {
    const row = norm[i % norm.length];
    push({
      cluster: "normalization_observed_cases",
      routingGroup: "calendar_write",
      input: row[0] + ", jen kalendář.",
      expectedIntent: "calendar.create",
      checks: { normalizationSignal: row[1], fieldCalendar: true }
    });
  }

  const hist = [
    "Kdy jsem naposledy měl schůzku s Jakubem",
    "Kdy naposledy byla schůzka s Petrem",
    "Naposledy jsem měl zubaře kdy"
  ];
  for (let i = 0; i < 12; i++) {
    push({
      cluster: "calendar_query_quality",
      routingGroup: "calendar_query",
      input: hist[i % hist.length] + "?",
      expectedIntent: "flexible_query",
      forbidWriteIntent: true,
      checks: { historicalStub: true }
    });
  }

  const analytics = [
    "Kolikrát jsem měl tento měsíc schůzku s Jakubem",
    "Kolik schůzek s Petrem mám tento měsíc",
    "Statistika úkolů za týden"
  ];
  for (let i = 0; i < 10; i++) {
    push({
      cluster: "task_query_quality",
      routingGroup: "task_query",
      input: analytics[i % analytics.length],
      expectedIntent: "flexible_query",
      forbidWriteIntent: true,
      checks: { analyticsStub: true }
    });
  }

  const update = [
    "Posuň schůzku s Petrem na 16:00",
    "Přesuň zítřejší schůzku s Jakubem na pátek dopoledne",
    "Změň čas schůzky s právníkem na 17:30"
  ];
  for (let i = 0; i < 15; i++) {
    push({
      cluster: "calendar_write_quality",
      routingGroup: "calendar_write",
      input: update[i % update.length],
      expectedIntent: "calendar.create",
      treatUnknownAsPass: true,
      allowAuditIntents: ["calendar.create", "unknown", "calendar.query"],
      checks: { updateFlow: true }
    });
  }

  const screenshots = [
    "Kdy mi končí záruka TV",
    "Nesmím zapomenout napsat do knihy úvodní kapitolu",
    "Ulož mi schůzku s panem Novotným 22.5. v 15 hod. místo je restaurace palma na náměstí bratří synků Praha",
    "Ulož mi ve čtvrtek schůzku s panem Zelenkou na adrese Praha jedna vinohradská a do poznámky mi dej ať si připravím smlouvu",
    "Ulož schůzku zítra v 15 a zvlášť si napiš poznámku že mám koupit kytku",
    "Silvere jen se podívej na schůzku zítra a nic neukládej",
    "Ulož mi pozítří schůzku s Jakubem potkáme se na Štvanici a připomeň mi ať si sebou vezmu mobilní telefon"
  ];
  const shotMeta = [
    { g: "note_query", e: "note.query", ch: { querySemantic: true } },
    { g: "task_write", e: "task.create", ch: { fieldTask: true } },
    { g: "calendar_write", e: "calendar.create", ch: { addressNotOnlyInTitle: true, fieldCalendar: true } },
    { g: "calendar_write", e: "calendar.create", ch: { fieldCalendar: true } },
    { g: "calendar_write", e: "calendar.create", ch: { fieldCalendar: true } },
    { g: "calendar_write", e: "calendar.query", ch: { forbidWriteIntent: true, safetyNoWrite: true, querySemantic: true } },
    { g: "calendar_write", e: "calendar.create", ch: { fieldCalendar: true } }
  ];
  for (let s = 0; s < screenshots.length; s++) {
    for (let rep = 0; rep < 2; rep++) {
      const meta = shotMeta[s];
      push({
        cluster: "real_user_screenshot_clusters",
        routingGroup: meta.g,
        input: screenshots[s],
        expectedIntent: meta.e,
        forbidWriteIntent: meta.ch.forbidWriteIntent || false,
        checks: meta.ch
      });
    }
  }

  return cases;
}

function addressOnlyInTitle(turn, foldedInput) {
  const d = turn.draft || {};
  const titleF = foldCs(d.title || "");
  const addrF = foldCs(String(d.address || d.location || ""));
  const locHints = ["manes", "most", "vacla", "karlov", "nadr", "brn", "svobod", "namest", "palma", "synk", "vinohrad", "zelenk", "novotn"];
  let hintHit = false;
  for (let i = 0; i < locHints.length; i++) {
    if (foldedInput.indexOf(locHints[i]) >= 0) {
      hintHit = true;
      break;
    }
  }
  if (!hintHit) return { ok: true, tag: "" };
  if (addrF.length < 6) {
    return { ok: false, tag: "address_in_title_only" };
  }
  let overlap = 0;
  for (let i = 0; i < locHints.length; i++) {
    const h = locHints[i];
    if (foldedInput.indexOf(h) >= 0 && titleF.indexOf(h) >= 0 && addrF.indexOf(h) < 0) overlap++;
  }
  if (overlap >= 2 && addrF.length < 8) return { ok: false, tag: "address_in_title_only" };
  return { ok: true, tag: "" };
}

function runOneCase(eng, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e) {
    void e;
  }
  const empty = eng.createEmptyDraft();
  const turn = eng.processUserTurn(c.input, empty, ctxForRoutingGroup(c.routingGroup));
  const foldedIn = foldCs(c.input);
  const d = turn.draft || {};
  const titleF = foldCs(d.title || "");
  const raw = rawUserMessage(turn);

  const failTags = [];
  let routingOk = routingPassForCase(c, turn);

  const createLike = createLikeTurn(turn);
  let dangerous = hasNegWrite(foldedIn) && createLike;
  let queryCreatedWrite = false;
  let falseWrite = false;

  if (c.forbidWriteIntent && createLike) {
    dangerous = dangerous || hasNegWrite(foldedIn);
    queryCreatedWrite = true;
    falseWrite = true;
  }
  if (c.routingGroup && c.routingGroup.indexOf("_query") !== -1 && createLike) {
    queryCreatedWrite = true;
    falseWrite = true;
  }

  if (c.checks) {
    if (c.checks.fieldCalendar) {
      const fq = evaluateFieldQualityCalendarWrite(turn);
      if (!fq.ok) failTags.push(fq.tag);
    }
    if (c.checks.fieldTask) {
      const fq = evaluateFieldQualityTaskWrite(turn);
      if (!fq.ok) failTags.push(fq.tag);
    }
    if (c.checks.fieldNote) {
      const fq = evaluateFieldQualityNoteWrite(turn);
      if (!fq.ok) failTags.push(fq.tag);
    }
    if (c.checks.querySemantic && c.routingGroup && c.cluster !== "safety_quality") {
      const qq = evaluateQuerySemantic(c.routingGroup, turn, foldedIn);
      if (!qq.ok) failTags.push(qq.tag);
    }
    if (c.checks.titlePollution && titleF) {
      const pol = titleHasPollutionFolded(titleF);
      if (pol.length) failTags.push("title_pollution:" + pol.join("+"));
    }
    if (c.checks.addressNotOnlyInTitle) {
      const aq = addressOnlyInTitle(turn, foldedIn);
      if (!aq.ok) failTags.push(aq.tag);
    }
    if (c.checks.embeddedNoteNeedle) {
      const noteF = foldCs(String(d.note || d.silverNoteText || ""));
      if (turn.normalizedIntent !== "calendar.create") failTags.push("embedded_not_calendar");
      else if (noteF.indexOf(c.checks.embeddedNoteNeedle) < 0) failTags.push("embedded_note_missing");
      if (c.checks.forbidStandaloneNote) {
        if (turn.normalizedIntent === "notes.create" && turn.processingState === "READY_TO_SAVE" && !turn.silverCompanionNoteTurn) {
          failTags.push("standalone_note_create");
        }
      }
    }
    if (c.checks.retrievalNarrow) {
      const rf = foldCs(raw);
      if (rf.indexOf(foldCs(c.checks.retrievalNarrow)) < 0) failTags.push("retrieval_quality_fail");
      if (/\b(vsechny|všechny|seznam\s+vsech|celý\s+seznam)\b/i.test(raw)) failTags.push("retrieval_too_broad");
    }
    if (c.checks.normalizationSignal) {
      const sig = c.checks.normalizationSignal;
      const hay = foldCs([d.title, d.date, d.dateISO, d.time, d.timeHHMM, d.address, d.location, raw].join(" "));
      const hasIso = d.dateISO && String(d.dateISO).length >= 8;
      const hasRel =
        /\bzitr|\bpozitr|\bpondel|\buter|\bstred|\bctvrt|\bpatek|\bsobot|\bnedel/.test(hay) ||
        /\bpo\s+obed|\bvecer|\bdopoledne|\bodpoledne/.test(hay);
      const hasDigits = /\b(9|10|11|12|15|16|17|18)\b/.test(hay);
      const observed = hay.indexOf(sig) >= 0 || hasIso || hasRel || hasDigits;
      if (!observed) failTags.push("normalization_observed_gap");
    }
    if (c.checks.updateFlow) {
      if (turn.normalizedIntent === "calendar.create" && turn.processingState === "READY_TO_SAVE") {
        failTags.push("update_risk_new_create");
      }
    }
    if (c.checks.historicalStub) {
      if (turn.normalizedIntent === "calendar.create" && turn.processingState === "READY_TO_SAVE") {
        failTags.push("historical_routed_as_create");
      }
    }
    if (c.checks.analyticsStub) {
      if (createLike) failTags.push("analytics_routed_as_write");
    }
  }

  if (!routingOk) failTags.push("routing_fail");

  const qualityOk = failTags.length === 0;
  const clusterFailKey = c.cluster + "||" + (failTags[0] || "pass");

  return {
    routingOk,
    qualityOk,
    failTags,
    clusterFailKey,
    dangerous,
    queryCreatedWrite,
    falseWrite,
    raw,
    turnSnapshot: {
      ni: turn.normalizedIntent,
      ps: turn.processingState,
      title: String(d.title || "").slice(0, 80)
    }
  };
}

function pct(a, b) {
  if (!b) return "0.00";
  return ((100 * a) / b).toFixed(2);
}

function main() {
  let eng;
  let scriptCrash = "NO";
  let reportWritten = "NO";
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("quality_audit_v2_runtime_fail=" + String(e && e.message));
    scriptCrash = "YES";
    const stub = {
      harness_id: HARNESS_ID,
      error: String(e && e.message),
      quality_audit_v2_script_crash: scriptCrash,
      quality_report_written: "NO"
    };
    fs.writeFileSync(REPORT_JSON, JSON.stringify(stub, null, 2), "utf8");
    process.exit(1);
  }

  const cases = buildCorpus();
  const failClusterCount = {};
  const fails = [];

  let dangerousWriteCount = 0;
  let falseWriteCount = 0;
  let queryCreatedWriteCount = 0;
  let unnecessaryDisambiguationCount = 0;

  let qualityPassed = 0;
  let routingPassed = 0;
  let fieldQpass = 0;
  let fieldQden = 0;
  let safetyPass = 0;
  let safetyDen = 0;
  let titleCleanPass = 0;
  let titleCleanDen = 0;
  let noteQpass = 0;
  let noteQden = 0;
  let addrPass = 0;
  let addrDen = 0;
  let retrPass = 0;
  let retrDen = 0;
  let normPass = 0;
  let normDen = 0;
  let updatePass = 0;
  let updateDen = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    let res;
    try {
      res = runOneCase(eng, c);
    } catch (err) {
      scriptCrash = "YES";
      fails.push({ id: c.id, cluster: c.cluster, err: String(err && err.message) });
      failClusterCount[c.cluster + "||runtime"] = (failClusterCount[c.cluster + "||runtime"] || 0) + 1;
      continue;
    }
    if (res.dangerous) dangerousWriteCount++;
    if (res.queryCreatedWrite) queryCreatedWriteCount++;
    if (res.falseWrite) falseWriteCount++;
    for (let fi = 0; fi < res.failTags.length; fi++) {
      if (res.failTags[fi] === "unnecessary_disambiguation") unnecessaryDisambiguationCount++;
    }

    if (res.routingOk) routingPassed++;

    const hasField = !!(c.checks && (c.checks.fieldCalendar || c.checks.fieldTask || c.checks.fieldNote));
    if (hasField) {
      fieldQden++;
      const badField = res.failTags.some((t) => /raw_response|unnecessary_disambiguation/.test(t));
      if (!badField && res.routingOk) fieldQpass++;
    }

    if (c.cluster === "safety_quality") {
      safetyDen++;
      if (res.qualityOk) safetyPass++;
    }

    if (c.checks && c.checks.titlePollution) {
      titleCleanDen++;
      const tp = res.failTags.every((t) => t.indexOf("title_pollution") !== 0);
      if (tp && res.routingOk) titleCleanPass++;
    }

    if (c.cluster === "embedded_event_note_quality" || (c.checks && c.checks.embeddedNoteNeedle)) {
      noteQden++;
      const nf = res.failTags.filter((t) => /embedded|standalone/.test(t));
      if (nf.length === 0 && res.routingOk) noteQpass++;
    }

    if (c.checks && c.checks.addressNotOnlyInTitle) {
      addrDen++;
      if (!res.failTags.includes("address_in_title_only") && res.routingOk) addrPass++;
    }

    if (c.checks && c.checks.retrievalNarrow) {
      retrDen++;
      if (!res.failTags.includes("retrieval_quality_fail") && !res.failTags.includes("retrieval_too_broad") && res.routingOk) {
        retrPass++;
      }
    }

    if (c.checks && c.checks.normalizationSignal) {
      normDen++;
      if (!res.failTags.includes("normalization_observed_gap") && res.routingOk) normPass++;
    }

    if (c.checks && c.checks.updateFlow) {
      updateDen++;
      if (!res.failTags.includes("update_risk_new_create")) updatePass++;
    }

    if (res.qualityOk) qualityPassed++;
    else {
      fails.push({
        id: c.id,
        cluster: c.cluster,
        tags: res.failTags,
        input: c.input.slice(0, 200)
      });
      const fk = res.clusterFailKey;
      failClusterCount[fk] = (failClusterCount[fk] || 0) + 1;
    }
  }

  const total = cases.length;
  const qualityFailed = total - qualityPassed;
  const topPairs = Object.keys(failClusterCount)
    .map((k) => ({ k: k, n: failClusterCount[k] }))
    .sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));

  let recommendedNextFixCluster = "";
  let recommendedNextFixReason = "";
  if (topPairs.length) {
    const parts = topPairs[0].k.split("||");
    const topK = parts[0] || topPairs[0].k;
    const topTag = parts[1] || "unknown_tag";
    recommendedNextFixCluster = topK;
    recommendedNextFixReason =
      "Largest fail mass: cluster «" +
      topK +
      "» / tag «" +
      topTag +
      "» (" +
      topPairs[0].n +
      " cases); safest next step is a narrow Silver change targeting this phrasing family (audit-only signal).";
  } else {
    recommendedNextFixCluster = "title_pollution_detection";
    recommendedNextFixReason =
      "No recorded fails in this baseline slice; default focus remains title/command-stripping hygiene for Czech mobile prompts.";
  }

  const topFailClusters = topPairs.slice(0, 15).map((p) => p.k + "=" + p.n);

  const reportObj = {
    harness_id: HARNESS_ID,
    fixed_now: FIXED_NOW_ISO,
    quality_total_cases: total,
    quality_passed: qualityPassed,
    quality_failed: qualityFailed,
    quality_accuracy: pct(qualityPassed, total),
    routing_accuracy: pct(routingPassed, total),
    field_quality_accuracy: pct(fieldQpass, fieldQden),
    safety_accuracy: pct(safetyPass, safetyDen),
    title_cleanliness_accuracy: pct(titleCleanPass, titleCleanDen),
    note_quality_accuracy: pct(noteQpass, noteQden),
    address_quality_accuracy: pct(addrPass, addrDen),
    retrieval_quality_accuracy: pct(retrPass, retrDen),
    normalization_quality_accuracy: pct(normPass, normDen),
    update_flow_accuracy: pct(updatePass, updateDen),
    dangerous_write_count: dangerousWriteCount,
    false_write_count: falseWriteCount,
    query_created_write_count: queryCreatedWriteCount,
    unnecessary_disambiguation_count: unnecessaryDisambiguationCount,
    top_fail_clusters: topFailClusters,
    recommended_next_fix_cluster: recommendedNextFixCluster,
    recommended_next_fix_reason: recommendedNextFixReason,
    quality_audit_v2_script_crash: scriptCrash,
    quality_report_written: "YES",
    sample_fails: fails.slice(0, 40)
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");
  reportWritten = "YES";

  const lines = [
    "=== SILVER_QUALITY_AUDIT_V2_FOUNDATION ===",
    "harness_id=" + HARNESS_ID,
    "quality_total_cases=" + total,
    "quality_passed=" + qualityPassed,
    "quality_failed=" + qualityFailed,
    "quality_accuracy=" + reportObj.quality_accuracy + "%",
    "routing_accuracy=" + reportObj.routing_accuracy + "%",
    "field_quality_accuracy=" + reportObj.field_quality_accuracy + "%",
    "safety_accuracy=" + reportObj.safety_accuracy + "%",
    "title_cleanliness_accuracy=" + reportObj.title_cleanliness_accuracy + "%",
    "note_quality_accuracy=" + reportObj.note_quality_accuracy + "%",
    "address_quality_accuracy=" + reportObj.address_quality_accuracy + "%",
    "retrieval_quality_accuracy=" + reportObj.retrieval_quality_accuracy + "%",
    "normalization_quality_accuracy=" + reportObj.normalization_quality_accuracy + "%",
    "update_flow_accuracy=" + reportObj.update_flow_accuracy + "%",
    "dangerous_write_count=" + dangerousWriteCount,
    "false_write_count=" + falseWriteCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "unnecessary_disambiguation_count=" + unnecessaryDisambiguationCount,
    "top_fail_clusters=" + topFailClusters.join(" | "),
    "recommended_next_fix_cluster=" + recommendedNextFixCluster,
    "recommended_next_fix_reason=" + recommendedNextFixReason,
    "quality_audit_v2_script_crash=" + scriptCrash,
    "quality_report_written=" + reportWritten,
    "=== END_SILVER_QUALITY_AUDIT_V2_FOUNDATION ==="
  ];
  console.log(lines.join("\n"));

  const baselineOk =
    scriptCrash === "NO" &&
    dangerousWriteCount === 0 &&
    falseWriteCount === 0 &&
    queryCreatedWriteCount === 0 &&
    recommendedNextFixCluster.length > 0;

  if (!baselineOk) {
    process.exit(2);
  }
}

main();
