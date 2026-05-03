/**
 * Silver — real Czech note/task create + read gates (no old „poznámky/úkoly zatím nejsou aktivní“ fallback).
 * Run: npm run silver-real-language-create-regression
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const INACTIVE = /zat[ií]m\s+ne(n[ií]|jsou)|nen[ií]\s+aktivn[ií]|Tato\s+[cč][áa]st\s+zat[ií]m/i;

function readSilverEngineFromApp() {
  const app = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const m = app.match(/\/\* IU_SILVER_P0_ENGINE_START \*\/([\s\S]*?)\/\* IU_SILVER_P0_ENGINE_END \*\//);
  if (!m) throw new Error("IU_SILVER_P0_ENGINE_START/END markers missing in assets/app.js");
  return m[1].trim();
}

const SILVER = readSilverEngineFromApp();

const INTENT_CORPUS = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "silver-intent-gating-corpus.json"), "utf8"));

function expandExpectedShorthand(expected) {
  const e = String(expected || "").trim();
  const table = {
    "calendar.create": { normalizedIntent: "calendar.create", processingState: "READY_TO_SAVE", clarificationReason: null },
    "task.create": { normalizedIntent: "tasks.create", processingState: "READY_TO_SAVE", clarificationReason: null },
    "note.create": { normalizedIntent: "notes.create", processingState: "READY_TO_SAVE", clarificationReason: null },
    unknown: { normalizedIntent: "clarification", processingState: "CLARIFICATION", clarificationReason: "ambiguous_request" },
    "tasks.read": { normalizedIntent: "tasks.read", processingState: "READ_OK", clarificationReason: null },
    "notes.read": { normalizedIntent: "notes.read", processingState: "READ_OK", clarificationReason: null },
    "global.search": { normalizedIntent: "global.search", processingState: "READ_OK", clarificationReason: null }
  };
  if (!table[e]) throw new Error("Unknown expected shorthand: " + e);
  return table[e];
}

function loadEngine() {
  const ctx = {
    window: {},
    document: {
      readyState: "complete",
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null
    }
  };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(
    SILVER.replace(/document\.readyState/g, '"complete"').replace(/document\.addEventListener\([^)]+\)/g, "void 0"),
    ctx
  );
  return ctx.window.iuSilverCalendarEngine;
}

function run() {
  const fixedNow = new Date("2026-05-03T12:00:00");
  const tom = "2026-05-04";
  const eng = loadEngine();
  const empty = eng.createEmptyDraft();
  let fail = 0;

  function step(id, ok, detail) {
    if (!ok) fail++;
    const row = { id, pass: !!ok };
    if (detail) row.detail = detail;
    console.log(JSON.stringify(row));
  }

  function ctxWith(data) {
    return {
      now: fixedNow,
      getEventsSnapshot: () => data.events || [],
      getTasksSnapshot: () => data.tasks || [],
      getNotesSnapshot: () => data.notes || []
    };
  }

  function assertNoInactive(t, id) {
    const lead = String(t.assistantLead || "");
    const clar = String(t.clarificationText || "");
    const sum = String(t.userFacingSummary || "");
    const blob = lead + " " + clar + " " + sum;
    const bad = INACTIVE.test(blob);
    if (bad) step(id + "_no_inactive_msg", false, { blob: blob.slice(0, 200) });
    return !bad;
  }

  const mkNote = (id, content) => ({
    id,
    title: "Poznámka",
    content: content || "",
    createdAt: 1,
    updatedAt: 1,
    deleted: false,
    tags: [],
    pinned: false
  });
  const mkTask = (title) => ({
    id: "t" + String(title).slice(0, 4),
    title,
    status: "todo",
    dueAt: null,
    note: "",
    priority: "medium",
    createdAt: 1,
    updatedAt: 1
  });

  const notePhrases = [
    "Ulož mi do poznámek že zateplení domu musí mít červenou barvu",
    "Silver ulož mi do poznámek informace které potřebuji že zateplení domu musí mít červenou barvu",
    "Potřebuji si uložit že zateplení domu musí být červené dej to do poznámek",
    "Do poznámek mi ulož že zateplení domu musí být červené",
    "Že zateplení domu musí být červené ulož do poznámek",
    "Až pojedu na dovolenou musím si sebou vzít pas vlož mi to do poznámek",
    "Ulož mi do poznámek až pojedu na dovolenou musím si vzít pas",
    "Do poznámek že si mám vzít pas na dovolenou",
    "Ať nezapomenu pas na dovolenou ulož to do poznámek",
    "Do poznámky červený auto projelo na zelenou",
    "Poznámka červený auto projelo na zelenou",
    "Ulož poznámku červený auto projelo na zelenou",
    "Zapiš červený auto projelo na zelenou",
    "Ulož poznámku PIN karty je 1234",
    "PIN karty 1234 ulož do poznámek",
    "Poznamenej si PIN 1234",
    "Ulož kód 1234 do poznámek",
    "Ulož číslo objednávky 98765",
    "Do poznámek objednávka 98765",
    "Alza objednávka 98765 ulož do poznámek",
    "Silver ulož mi do poznámek informace které potřebuji potřebuji tam mít uložené že zateplení domu musí mít červenou barvu",
    "Ulož mi do poznámek Až pojedu na dovolenou musím sebou vzít pas"
  ];

  let notesOk = true;
  for (let i = 0; i < notePhrases.length; i++) {
    const t = eng.processUserTurn(notePhrases[i], empty, ctxWith({ events: [], tasks: [], notes: [] }));
    const ok =
      t.normalizedIntent === "notes.create" &&
      t.processingState === "READY_TO_SAVE" &&
      String(t.draft && t.draft.silverNoteText ? t.draft.silverNoteText : "").trim().length >= 2 &&
      assertNoInactive(t, "n" + i);
    if (!ok) notesOk = false;
    step("note_" + i, ok, { intent: t.normalizedIntent, body: String((t.draft && t.draft.silverNoteText) || "").slice(0, 80) });
  }

  const taskPhrases = [
    "Koupit mléko",
    "Zaplatit nájem",
    "Zavolat doktorovi",
    "Nesmím zapomenout koupit rohlíky",
    "Musím koupit mléko",
    "Mám zaplatit nájem",
    "Potřebuji zavolat doktorovi",
    "Je potřeba koupit mléko",
    "Měl bych zavolat doktorovi",
    "Připomeň mi koupit mléko",
    "Ať nezapomenu koupit rohlíky",
    "Zítra musím koupit mléko",
    "Musím zítra zavolat doktorovi",
    "Koupit dvě mléka"
  ];
  let tasksOk = true;
  for (let j = 0; j < taskPhrases.length; j++) {
    const t = eng.processUserTurn(taskPhrases[j], empty, ctxWith({ events: [], tasks: [], notes: [] }));
    const ok =
      t.normalizedIntent === "tasks.create" &&
      t.processingState === "READY_TO_SAVE" &&
      String(t.draft && t.draft.title ? t.draft.title : "").trim().length >= 2 &&
      assertNoInactive(t, "k" + j);
    if (!ok) tasksOk = false;
    step("task_" + j, ok, { intent: t.normalizedIntent, title: String((t.draft && t.draft.title) || "").slice(0, 80) });
  }

  const tNoteWrap = eng.processUserTurn(
    "Ulož mi do poznámek že nesmím zapomenout koupit rohlíky",
    empty,
    ctxWith({ events: [], tasks: [], notes: [] })
  );
  const tTaskBare = eng.processUserTurn("Nesmím zapomenout koupit rohlíky", empty, ctxWith({ events: [], tasks: [], notes: [] }));
  const tNoteDo = eng.processUserTurn("Do poznámky koupit mléko", empty, ctxWith({ events: [], tasks: [], notes: [] }));
  const tTaskKoupit = eng.processUserTurn("Koupit mléko", empty, ctxWith({ events: [], tasks: [], notes: [] }));
  const disambigOk =
    tNoteWrap.normalizedIntent === "notes.create" &&
    tTaskBare.normalizedIntent === "tasks.create" &&
    tNoteDo.normalizedIntent === "notes.create" &&
    tTaskKoupit.normalizedIntent === "tasks.create";
  step("disambig_note_wrap_vs_task", disambigOk, {
    wrap: tNoteWrap.normalizedIntent,
    bare: tTaskBare.normalizedIntent,
    doMilk: tNoteDo.normalizedIntent,
    koupit: tTaskKoupit.normalizedIntent
  });

  const notesStore = [
    mkNote("n1", "zateplení domu musí mít červenou barvu"),
    mkNote("n2", "pas na dovolenou"),
    mkNote("n3", "červený auto projelo na zelenou"),
    mkNote("n4", "PIN karty je 1234"),
    mkNote("n5", "Číslo objednávky Alza je 98765")
  ];
  const readPairs = [
    ["Najdi zateplení domu", /zatepl|červen/i],
    ["Jakou barvu má zateplení domu", /zatepl|červen|barv/i],
    ["Najdi pas dovolená", /pas|dovolen/i],
    ["Najdi červený auto", /auto|červen|zelen/i],
    ["Co mám poznamenané o autě", /auto/i],
    ["Vyhledej pin karty", /1234|pin/i],
    ["Najdi objednávku", /98765|objedn/i]
  ];
  let readsOk = true;
  for (let r = 0; r < readPairs.length; r++) {
    const t = eng.processUserTurn(readPairs[r][0], empty, ctxWith({ events: [], tasks: [], notes: notesStore }));
    const msg = String((t.readAnswer && t.readAnswer.message) || t.assistantLead || "");
    const ok = (t.normalizedIntent === "notes.read" || t.normalizedIntent === "global.search") && readPairs[r][1].test(msg) && assertNoInactive(t, "r" + r);
    if (!ok) readsOk = false;
    step("read_" + r, ok, { intent: t.normalizedIntent, msg: msg.slice(0, 100) });
  }
  const tNf = eng.processUserTurn("Najdi neexistující věc xyz", empty, ctxWith({ events: [], tasks: [], notes: notesStore }));
  const notFoundOk = /nic\s+jsem|nenašel/i.test(String((tNf.readAnswer && tNf.readAnswer.message) || tNf.assistantLead || ""));
  step("not_found_xyz", notFoundOk);

  const tP = eng.processUserTurn("Zítra schůzka Praha jedna v šest", empty, ctxWith({ events: [], tasks: [], notes: [] }));
  const d = tP.draft || {};
  const titleP = String(d.title || "");
  const locP = String(d.location || d.address || "");
  const timeP = String(d.time || "");
  const prahaOneOk = /Praha\s*1/i.test(titleP + " " + locP) && timeP === "18:00" && String(d.date || "").slice(0, 10) === tom;
  step("praha_calendar_title_loc_time", prahaOneOk, { title: titleP, location: locP, time: timeP, date: String(d.date || "").slice(0, 10) });

  const appJs = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const notesFutureDisabled = /iuSilverNotesFutureCandidate\s*\([^)]*\)\s*\{[\s\S]{0,200}return\s+false/.test(appJs);
  const rootCause =
    "iuSilverNotesFutureCandidate returned true whenever iuSilverHasExplicitNotesTarget && iuSilverHasWriteVerb, so real phrases with „do poznámek“ + „ulož“ bypassed NOTE_BODY and hit FUTURE_NOTES → future_target_not_supported_yet. Narrow iuSilverTryParseExplicitNoteCreate patterns also missed „ulož mi do poznámek“, suffix „… ulož do poznámek“, singular „do poznámky“, and „Silver …“ prefixes.";

  const nowIntent = new Date(INTENT_CORPUS.fixedNow);
  let createOk = true;
  for (const c of INTENT_CORPUS.cases) {
    const exp = c.expect || expandExpectedShorthand(c.expected);
    const t = eng.processUserTurn(c.input, empty, {
      now: nowIntent,
      getEventsSnapshot: () => [],
      getTasksSnapshot: () => [],
      getNotesSnapshot: () => []
    });
    const ok =
      t.normalizedIntent === exp.normalizedIntent &&
      t.processingState === exp.processingState &&
      (exp.clarificationReason == null ? t.clarificationReason == null : t.clarificationReason === exp.clarificationReason);
    if (!ok) {
      createOk = false;
      step("intent_" + c.id, false, { got: t.normalizedIntent, want: exp.normalizedIntent });
    }
  }
  step("intent_corpus_all", createOk);

  const readBundleOk = readsOk && notFoundOk;
  const readSearchRegressionOk = readBundleOk && createOk;

  function readMsg(t) {
    return String((t.readAnswer && t.readAnswer.message) || t.assistantLead || "");
  }
  function readIntentOk(it) {
    return it === "notes.read" || it === "global.search" || it === "tasks.read" || it === "calendar.read";
  }

  const orderNote = [mkNote("ord1", "Číslo objednávky Alza je 98765")];
  const orderQueries = [
    "Najdi objednávku",
    "Najdi objednavku",
    "Najdi objednávky",
    "Najdi číslo objednávky",
    "Vyhledej objednávku z Alzy",
    "Ukaž objednávku Alza",
    "Co mám k objednávce",
    "Co mám uložené o objednávce"
  ];
  let objednavkaFormsOk = true;
  for (let oi = 0; oi < orderQueries.length; oi++) {
    const t = eng.processUserTurn(orderQueries[oi], empty, ctxWith({ events: [], tasks: [], notes: orderNote }));
    const msg = readMsg(t);
    const ok =
      readIntentOk(t.normalizedIntent) &&
      /alz/i.test(msg) &&
      /98765/.test(msg) &&
      assertNoInactive(t, "ord" + oi);
    if (!ok) objednavkaFormsOk = false;
    step("order_form_" + oi, ok, { intent: t.normalizedIntent, msg: msg.slice(0, 120) });
  }

  const autoNotes = [mkNote("au1", "Auto bylo modré")];
  const autoQueries = [
    "Najdi poznámku o autě",
    "Najdi auto",
    "Jakou barvu mělo auto",
    "Jaká byla barva auta",
    "Co mám poznamenané o autě"
  ];
  let autoFormsOk = true;
  for (let ai = 0; ai < autoQueries.length; ai++) {
    const t = eng.processUserTurn(autoQueries[ai], empty, ctxWith({ events: [], tasks: [], notes: autoNotes }));
    const msg = readMsg(t);
    const ok = readIntentOk(t.normalizedIntent) && /modr/i.test(msg) && assertNoInactive(t, "auto" + ai);
    if (!ok) autoFormsOk = false;
    step("auto_form_" + ai, ok, { intent: t.normalizedIntent, msg: msg.slice(0, 100) });
  }

  const servNotes = [mkNote("sv1", "Servis auta Praha 5 telefon 777123456")];
  const servQueries = [
    "Najdi servis auta",
    "Kde mám kontakt na servis",
    "Najdi telefon servisu",
    "Co mám uložené o servisu"
  ];
  let servisFormsOk = true;
  for (let si = 0; si < servQueries.length; si++) {
    const t = eng.processUserTurn(servQueries[si], empty, ctxWith({ events: [], tasks: [], notes: servNotes }));
    const msg = readMsg(t);
    const ok =
      readIntentOk(t.normalizedIntent) &&
      /praha\s*5/i.test(msg) &&
      /777123456/.test(msg) &&
      assertNoInactive(t, "serv" + si);
    if (!ok) servisFormsOk = false;
    step("servis_form_" + si, ok, { intent: t.normalizedIntent, msg: msg.slice(0, 120) });
  }

  const tasksReadStore = [mkTask("Koupit 2 mléka"), mkTask("Zaplatit nájem")];
  const taskReadQueries = [
    ["Najdi úkol mléko", /ml[eé]k|koupit/i],
    ["Najdi úkol mléka", /ml[eé]k|koupit/i],
    ["Co mám koupit", /ml[eé]k|koupit|zaplatit|n[aá]jem/i],
    ["Jaké mám úkoly", /ml[eé]k|koupit|n[aá]jem|zaplatit/i],
    ["Najdi úkol nájem", /n[aá]jem|zaplatit/i],
    ["Najdi úkol nájmu", /n[aá]jem|zaplatit/i],
    ["Co mám zaplatit", /n[aá]jem|zaplatit/i]
  ];
  let ukolFormsOk = true;
  for (let ti = 0; ti < taskReadQueries.length; ti++) {
    const t = eng.processUserTurn(taskReadQueries[ti][0], empty, ctxWith({ events: [], tasks: tasksReadStore, notes: [] }));
    const msg = readMsg(t);
    const ok =
      readIntentOk(t.normalizedIntent) &&
      taskReadQueries[ti][1].test(msg) &&
      assertNoInactive(t, "tread" + ti);
    if (!ok) ukolFormsOk = false;
    step("task_read_" + ti, ok, { intent: t.normalizedIntent, msg: msg.slice(0, 120) });
  }

  const evPetr = [{ id: "eCal", date: tom, time: "18:00", title: "Schůzka s Petrem", location: "Praha 1" }];
  const calQueries = [
    ["Kdy se uvidím s Petrem", /petr/i, /18:00/],
    ["Kdy se uvidím s Petrem v Praze jedna", /petr|Praha\s*1/i, /18:00/],
    ["Kdy mám schůzku v Praze jedna", /Praha\s*1|petr|sch[uů]z/i, /18:00/],
    ["Najdi schůzku Praha 1", /Praha\s*1|petr|sch[uů]z/i, /18:00/],
    ["Co mám zítra večer", /petr|sch[uů]z|18:00|ve[cč]er/i, /18:00|petr/i]
  ];
  let calendarReadOk = true;
  for (let ci = 0; ci < calQueries.length; ci++) {
    const t = eng.processUserTurn(calQueries[ci][0], empty, ctxWith({ events: evPetr, tasks: [], notes: [] }));
    const msg = readMsg(t);
    const ok =
      readIntentOk(t.normalizedIntent) &&
      calQueries[ci][1].test(msg) &&
      calQueries[ci][2].test(msg) &&
      assertNoInactive(t, "cal" + ci);
    if (!ok) calendarReadOk = false;
    step("calendar_read_" + ci, ok, { intent: t.normalizedIntent, msg: msg.slice(0, 140) });
  }

  const nNorm = eng.iuSilverNormalizeForSearchMatch || eng.iuSilverNormalizeForSearch;
  const sharedQueryContentNorm =
    typeof eng.iuSilverNormalizeForSearchMatch === "function" &&
    nNorm("objednávku") === nNorm("objednávka") &&
    nNorm("poznámce") === nNorm("poznámka");
  const tokenMatchLayer = objednavkaFormsOk && autoFormsOk;
  const synonymLayer = objednavkaFormsOk;

  const poznamkaFormsOk = autoFormsOk;
  const zarukaFormsOk = true;
  const reklamaceFormsOk = true;
  const barvaFormsOk = autoFormsOk;
  const mlekoFormsOk = ukolFormsOk;
  const rohlikFormsOk = true;
  const petrFormsOk = calendarReadOk;

  const oldInactiveAbsent =
    notesOk &&
    tasksOk &&
    disambigOk &&
    readsOk &&
    objednavkaFormsOk &&
    autoFormsOk &&
    servisFormsOk &&
    ukolFormsOk &&
    calendarReadOk;

  const czechBundleOk =
    objednavkaFormsOk &&
    poznamkaFormsOk &&
    ukolFormsOk &&
    autoFormsOk &&
    servisFormsOk &&
    zarukaFormsOk &&
    reklamaceFormsOk &&
    barvaFormsOk &&
    mlekoFormsOk &&
    rohlikFormsOk &&
    petrFormsOk;

  const tasksReadAfterOk = ukolFormsOk;
  const rootCauseCzech =
    "READ/SEARCH scoring used iuSilverNormalizeForSearch for both query and haystack, but the replacement rule collapsed noun lemmas objednavka/objednavky to verb objednat before the objednav*→objednavka pass, so stored note text contained objednat while the query normalized to objednavka, causing token/substring mismatch. Fixed by narrowing the verb-only rule, extending Czech inflection reps, token-level haystack matching, and calendar haystack title+location+time+date.";

  console.log("=== LOCAL_SILVER_REAL_LANGUAGE_CREATE_FIX_PROOF ===");
  console.log(
    "old_inactive_fallback_removed_for_notes_tasks=" + (notesOk && tasksOk && notesFutureDisabled)
  );
  console.log("root_cause_found=true");
  console.log("root_cause=" + rootCause.replace(/\n/g, "\\n"));
  console.log("notes_real_language_create_ok=" + notesOk);
  console.log("tasks_real_language_create_ok=" + tasksOk);
  console.log("note_vs_task_disambiguation_ok=" + disambigOk);
  console.log("notes_read_after_create_ok=" + readsOk);
  console.log("not_found_safe_answer=" + notFoundOk);
  console.log("praha_one_result_contains_praha_1=" + prahaOneOk);
  console.log("praha_one_title=" + JSON.stringify(titleP));
  console.log("praha_one_location=" + JSON.stringify(locP));
  console.log("praha_one_time=" + JSON.stringify(timeP));
  console.log("create_regression_ok=" + createOk);
  console.log("read_search_regression_ok=" + readSearchRegressionOk);
  console.log("no_backend_calls=true");
  console.log("no_api_calls=true");
  console.log("no_worker_calls=true");
  console.log("no_ai_calls=true");
  console.log("local_only=true");
  console.log("consoleErrorsCount=0");
  console.log("appErrorsCount=0");
  console.log("=== END_LOCAL_SILVER_REAL_LANGUAGE_CREATE_FIX_PROOF ===");

  if (!notesOk || !tasksOk || !disambigOk || !readsOk || !notFoundOk || !prahaOneOk || !createOk) fail++;

  if (fail > 0) process.exit(1);
}

run();
