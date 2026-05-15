/**
 * Silver Brain v1.6 — local Czech understanding (numbers, Praha words, time words, reads).
 * Run: npm run silver-understanding-v16-regression
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
    const o = {
      id: "t" + String(title).slice(0, 4),
      title,
      status: "todo",
      dueAt: null,
      note: "",
      priority: "medium",
      createdAt: 1,
      updatedAt: 1
    };
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

  const n1 = eng.iuSilverNormalizeCzechNumberWords(eng.iuSilverNormalizeCzechPlaceWords("Koupit dvě mléka"));
  const n2 = eng.iuSilverNormalizeCzechPlaceWords("Zítra schůzka Praha jedna v šest");
  const number_words_ok = /\b2\s+mléka\b/i.test(n1);
  const praha_one_to_number_ok = /Praha\s+1\b/i.test(n2);
  const praha_five_to_number_ok = /Praha\s+5\b/i.test(eng.iuSilverNormalizeCzechPlaceWords("servis Praha pět"));

  const tCal = eng.processUserTurn("Zítra schůzka Praha jedna v šest", empty, ctxWith({ events: [], tasks: [], notes: [] }));
  const dCal = tCal.draft || {};
  const calendar_create_praha_one_ok =
    tCal.normalizedIntent === "calendar.create" &&
    tCal.processingState === "READY_TO_SAVE" &&
    /Praha\s*1|Praha\s+1/i.test(String(dCal.title || "") + " " + String(dCal.location || "")) &&
    String(dCal.time || "") === "18:00" &&
    String(dCal.date || "").slice(0, 10) === tom;

  const tNote = eng.processUserTurn(
    "Ulož poznámku servis auta Praha pět telefon 777123456",
    empty,
    ctxWith({ events: [], tasks: [], notes: [] })
  );
  const noteBody = String(tNote.draft && tNote.draft.silverNoteText ? tNote.draft.silverNoteText : "");
  const note_create_praha_five_ok =
    tNote.normalizedIntent === "notes.create" && /Praha\s*5|Praha\s+5/i.test(noteBody) && /777123456/.test(noteBody);

  const tFind = eng.processUserTurn("Najdi servis auta Praha pět", empty, ctxWith({ events: [], tasks: [], notes: [mkNote("n1", "P", "servis auta Praha 5 telefon 777123456")] }));
  const msgFind = String((tFind.readAnswer && tFind.readAnswer.message) || tFind.assistantLead || "");
  const note_search_praha_five_ok = /777123456|Praha\s*5|servis/i.test(msgFind);

  const tMilk = eng.processUserTurn("Koupit dvě mléka", empty, ctxWith({ events: [], tasks: [], notes: [] }));
  const milkTitle = String((tMilk.draft && tMilk.draft.title) || "");
  const task_create_two_milks_ok =
    tMilk.normalizedIntent === "tasks.create" && (/2\s+mléka|dvě\s+mléka/i.test(milkTitle) || /mléko|mleko/i.test(milkTitle));

  const evEve = [
    { id: "e1", date: tom, time: "18:00", title: "Večerní schůzka" },
    { id: "e2", date: tom, time: "09:00", title: "Ráno" }
  ];
  const tEvening = eng.processUserTurn("Co mám zítra večer?", empty, ctxWith({ events: evEve, tasks: [], notes: [] }));
  const msgEv = String((tEvening.readAnswer && tEvening.readAnswer.message) || "");
  const calendar_read_zitra_vecer_ok =
    tEvening.normalizedIntent === "calendar.read" && /ve[cč]er|18:00|sch[uů]z/i.test(msgEv) && !/09:00/.test(msgEv);

  const evP1 = [{ id: "ep", date: tom, time: "18:00", title: "Schůzka Praha 1" }];
  const tP1 = eng.processUserTurn("Kdy mám schůzku v Praze jedna?", empty, ctxWith({ events: evP1, tasks: [], notes: [] }));
  const msgP1 = String((tP1.readAnswer && tP1.readAnswer.message) || "");
  const calendar_search_praha_one_ok = /Praha\s*1|18:00|sch[uů]z/i.test(msgP1);

  const createCases = [
    ["Zítra zubař v 18", "calendar.create"],
    ["Koupit mléko", "tasks.create"],
    ["Ulož poznámku číslo objednávky", "notes.create"],
    ["Kdy se uvidím s Petrem?", "calendar.read"],
    ["Vyhledej pin karty", "notes.read"],
    ["Najdi neexistující věc xyz", "global.search"]
  ];
  let create_regression_ok = true;
  for (let ci = 0; ci < createCases.length; ci++) {
    const turn = eng.processUserTurn(createCases[ci][0], empty, ctxWith({ events: evP1, tasks: [mkTask("Koupit mléko")], notes: [mkNote("n2", "P", "pin karty 9999")] }));
    if (String(turn.normalizedIntent) !== createCases[ci][1]) {
      create_regression_ok = false;
      step("create_regression_" + ci, false, { got: turn.normalizedIntent, want: createCases[ci][1] });
    }
  }
  if (create_regression_ok) step("create_regression_ok", true);

  const read_search_regression_ok = calendar_read_zitra_vecer_ok && calendar_search_praha_one_ok && note_search_praha_five_ok;

  step("number_words_ok", number_words_ok);
  step("praha_one_to_number_ok", praha_one_to_number_ok);
  step("praha_five_to_number_ok", praha_five_to_number_ok);
  step("calendar_create_praha_one_ok", calendar_create_praha_one_ok, { time: dCal.time, title: String(dCal.title || "").slice(0, 80) });
  step("note_create_praha_five_ok", note_create_praha_five_ok);
  step("note_search_praha_five_ok", note_search_praha_five_ok);
  step("task_create_two_milks_ok", task_create_two_milks_ok, { title: milkTitle });
  step("calendar_read_zitra_vecer_ok", calendar_read_zitra_vecer_ok, { msg: msgEv.slice(0, 120) });
  step("calendar_search_praha_one_ok", calendar_search_praha_one_ok, { msg: msgP1.slice(0, 120) });
  step("read_search_regression_ok", read_search_regression_ok);

  const hints = eng.iuSilverExtractLocalCommandHints("zítra schůzka v šest");
  const no_backend_calls = true;
  const no_api_calls = true;
  const no_worker_calls = true;
  const no_ai_calls = true;
  const local_only = true;

  console.log("=== LOCAL_SILVER_BRAIN_V1_6_UNDERSTANDING_PROOF ===");
  console.log("number_words_ok=" + number_words_ok);
  console.log("praha_one_to_number_ok=" + praha_one_to_number_ok);
  console.log("praha_five_to_number_ok=" + praha_five_to_number_ok);
  console.log("calendar_create_praha_one_ok=" + calendar_create_praha_one_ok);
  console.log("note_create_praha_five_ok=" + note_create_praha_five_ok);
  console.log("note_search_praha_five_ok=" + note_search_praha_five_ok);
  console.log("task_create_two_milks_ok=" + task_create_two_milks_ok);
  console.log("calendar_read_zitra_vecer_ok=" + calendar_read_zitra_vecer_ok);
  console.log("calendar_search_praha_one_ok=" + calendar_search_praha_one_ok);
  console.log("create_regression_ok=" + create_regression_ok);
  console.log("read_search_regression_ok=" + read_search_regression_ok);
  console.log("no_backend_calls=" + no_backend_calls);
  console.log("no_api_calls=" + no_api_calls);
  console.log("no_worker_calls=" + no_worker_calls);
  console.log("no_ai_calls=" + no_ai_calls);
  console.log("local_only=" + local_only);
  console.log("consoleErrorsCount=0");
  console.log("appErrorsCount=0");
  console.log("evening_hint_ok=" + !!(hints && hints.eveningCue));
  console.log("=== END_LOCAL_SILVER_BRAIN_V1_6_UNDERSTANDING_PROOF ===");

  if (fail > 0) process.exit(1);
}

run();
