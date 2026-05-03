/**
 * Silver Brain v1.5 — local READ/SEARCH/ANSWER regression (VM, no network).
 * Run: npm run silver-search-v15-regression
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function readSilverEngineFromApp() {
  const app = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const m = app.match(/\/\* IU_SILVER_P0_ENGINE_START \*\/([\s\S]*?)\/\* IU_SILVER_P0_ENGINE_END \*\//);
  if (!m) throw new Error("IU_SILVER_P0_ENGINE_START/END markers missing in assets/app.js");
  return m[1].trim();
}

const SILVER = readSilverEngineFromApp();

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

  const mkTask = (title, extra) => {
    const o = { id: "t" + String(title).slice(0, 3), title, status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 };
    return Object.assign(o, extra || {});
  };
  const mkNote = (id, title, content) => ({
    id,
    title: title || "Poznámka",
    content: content || "",
    createdAt: 1,
    updatedAt: 1,
    deleted: false,
    tags: [],
    pinned: false
  });

  /* A — Petr + kdy se */
  let evPetr = [{ id: "eP", date: tom, time: "18:00", title: "Schůzka s Petrem" }];
  let tA = eng.processUserTurn("Kdy se uvidím s Petrem?", empty, ctxWith({ events: evPetr, tasks: [], notes: [] }));
  const msgA = String((tA.readAnswer && tA.readAnswer.message) || tA.assistantLead || "");
  step(
    "A_calendar_petr",
    tA.normalizedIntent === "calendar.read" && /petr/i.test(msgA) && /18:00/.test(msgA),
    { intent: tA.normalizedIntent, msg: msgA.slice(0, 120) }
  );

  /* B — zubař */
  let evZ = [{ id: "eZ", date: tom, time: "18:00", title: "Zubař" }];
  let tB = eng.processUserTurn("V kolik mám zubaře?", empty, ctxWith({ events: evZ, tasks: [], notes: [] }));
  const msgB = String((tB.readAnswer && tB.readAnswer.message) || tB.assistantLead || "");
  step("B_zubar_time", /zuba/i.test(msgB) && /18:00/.test(msgB), { msg: msgB.slice(0, 120) });

  /* C — day overview */
  let evC = [
    { id: "c1", date: tom, time: "09:00", title: "Porada" },
    { id: "c2", date: tom, time: "11:00", title: "Jiné" }
  ];
  let tC = eng.processUserTurn("Co mám zítra?", empty, ctxWith({ events: evC, tasks: [], notes: [] }));
  const msgC = String((tC.readAnswer && tC.readAnswer.message) || tC.assistantLead || "");
  step("C_day_overview", /porada/i.test(msgC) && /09:00/.test(msgC), { msg: msgC.slice(0, 160) });

  /* D — task search */
  let tasksD = [mkTask("Zaplatit nájem")];
  let tD = eng.processUserTurn("Najdi úkol nájem", empty, ctxWith({ events: [], tasks: tasksD, notes: [] }));
  const msgD = String((tD.readAnswer && tD.readAnswer.message) || tD.assistantLead || "");
  step(
    "D_task_search",
    tD.normalizedIntent === "tasks.read" && /zaplatit\s+nájem/i.test(msgD),
    { intent: tD.normalizedIntent }
  );

  /* E — task list */
  let tasksE = [mkTask("Koupit mléko"), mkTask("Zavolat doktorovi")];
  let tE = eng.processUserTurn("Jaké mám úkoly?", empty, ctxWith({ events: [], tasks: tasksE, notes: [] }));
  const msgE = String((tE.readAnswer && tE.readAnswer.message) || tE.assistantLead || "");
  step(
    "E_task_list",
    tE.normalizedIntent === "tasks.read" && /mléko|mleko/i.test(msgE) && /doktor/i.test(msgE),
    { intent: tE.normalizedIntent }
  );

  /* F — PIN note */
  let notesF = [mkNote("n1", "Poznámka", "PIN karty je 1234")];
  let tF = eng.processUserTurn("Vyhledej pin karty", empty, ctxWith({ events: [], tasks: [], notes: notesF }));
  const msgF = String((tF.readAnswer && tF.readAnswer.message) || tF.assistantLead || "");
  step("F_note_pin", tF.normalizedIntent === "notes.read" && msgF.indexOf("1234") >= 0, {});

  /* G — barva auta */
  let notesG = [mkNote("n2", "Auto", "Auto bylo modré")];
  let tG = eng.processUserTurn("Jakou barvu mělo auto?", empty, ctxWith({ events: [], tasks: [], notes: notesG }));
  const msgG = String((tG.readAnswer && tG.readAnswer.message) || tG.assistantLead || "");
  step("G_note_color", /modr/i.test(msgG), { msg: msgG.slice(0, 120) });

  /* H — Alza order */
  let notesH = [mkNote("n3", "Objednávka", "Číslo objednávky Alza je 98765")];
  let tH = eng.processUserTurn("Najdi objednávku z Alzy", empty, ctxWith({ events: [], tasks: [], notes: notesH }));
  const msgH = String((tH.readAnswer && tH.readAnswer.message) || tH.assistantLead || "");
  step("H_order_alza", msgH.indexOf("98765") >= 0 && /alz/i.test(msgH), {});

  /* I — global Petr */
  let dataI = {
    events: [{ id: "i1", date: tom, time: "10:00", title: "Schůzka s Petrem" }],
    tasks: [mkTask("Zavolat Petrovi")],
    notes: [mkNote("i2", "Kontakt", "Petr má servisní kontakt 777123456")]
  };
  let tI = eng.processUserTurn("Najdi Petra", empty, ctxWith(dataI));
  const msgI = String((tI.readAnswer && tI.readAnswer.message) || tI.assistantLead || "");
  step(
    "I_global_petr",
    tI.normalizedIntent === "global.search" && /petr/i.test(msgI) && msgI.length > 8,
    { intent: tI.normalizedIntent }
  );

  /* J — not found */
  let tJ = eng.processUserTurn("Najdi neexistující věc xyz", empty, ctxWith({ events: [], tasks: [], notes: [] }));
  const msgJ = String((tJ.readAnswer && tJ.readAnswer.message) || tJ.assistantLead || "").trim();
  step("J_not_found", msgJ === "Nic jsem k tomu nenašel.", { msg: msgJ });

  /* K — create regression */
  let tK1 = eng.processUserTurn("Zítra zubař v 18", empty, ctxWith({ events: [], tasks: [], notes: [] }));
  let tK2 = eng.processUserTurn("Koupit mléko", empty, ctxWith({ events: [], tasks: [], notes: [] }));
  let tK3 = eng.processUserTurn("Ulož poznámku číslo objednávky 123", empty, ctxWith({ events: [], tasks: [], notes: [] }));
  step(
    "K_create_regression",
    tK1.normalizedIntent === "calendar.create" &&
      tK2.normalizedIntent === "tasks.create" &&
      tK3.normalizedIntent === "notes.create",
    {}
  );

  /* Engine exports */
  step(
    "exports_v15",
    typeof eng.iuSilverNormalizeForSearch === "function" &&
      typeof eng.iuSilverSearchLocalData === "function" &&
      typeof eng.iuSilverBuildAnswerFromSearch === "function",
    {}
  );

  const summary = { total: 13, fail, exitCode: fail > 0 ? 1 : 0, silverBrainV15: "local_read_search_answer" };
  console.log(JSON.stringify({ summary }));
  process.exit(summary.exitCode);
}

run();
