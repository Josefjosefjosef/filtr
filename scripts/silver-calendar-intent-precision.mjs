/**
 * P0: Silver calendar create/read intent precision — deterministic checks.
 * Run: node scripts/silver-calendar-intent-precision.mjs
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

const FIXED_NOW = "2026-03-27T12:00:00";

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

const cases = [
  {
    id: "1-create-petr",
    input: "V 10 hod. mám schůzku s Petrem ulož mi to do kalendáře",
    expect: { ni: "calendar.create", ps: "READY_TO_SAVE", date: "2026-03-27", time: "10:00", titleHas: "Petrem", notRead: true }
  },
  {
    id: "2-create-najem",
    input: "Dnes odpoledne v 15 hod. zaplatit nájem ulož mi to do kalendáře",
    expect: { ni: "calendar.create", ps: "READY_TO_SAVE", date: "2026-03-27", time: "15:00", titleHas: "nájem", titleNot: "Odpoledne", notRead: true }
  },
  {
    id: "3-create-karel",
    input: "Ulož mi do kalendáře dnešní schůzku v 15 hod. s Karlem",
    expect: { ni: "calendar.create", ps: "READY_TO_SAVE", date: "2026-03-27", time: "15:00", titleHas: "Karl", notRead: true }
  },
  {
    id: "4-read-count-schuzek",
    input: "Kolik mám dnes celkem schůzek?",
    expect: { ni: "calendar.read", ps: "READ_OK", notStorage: true }
  },
  {
    id: "5-read-last-vkolik",
    input: "V kolik hodin mám poslední schůzku dnes?",
    expect: { ni: "calendar.read", ps: "READ_OK", notStorage: true }
  },
  {
    id: "6-read-last-podle-kal",
    input: "V kolik hodin mám dnes podle kalendáře poslední schůzku?",
    expect: { ni: "calendar.read", ps: "READ_OK", notStorage: true }
  },
  {
    id: "7-disamb-ulož-mi-to",
    input: "ulož mi to",
    expect: { ni: "clarification", ps: "CLARIFICATION", cr: "missing_explicit_target" }
  },
  {
    id: "8-read-kolik-no-disamb",
    input: "Kolik mám dnes schůzek?",
    expect: { ni: "calendar.read", ps: "READ_OK", notStorage: true }
  },
  {
    id: "9-create-zitra-porada",
    input: "Přidej zítra v 8 poradu",
    expect: { ni: "calendar.create", ps: "READY_TO_SAVE" }
  }
];

function run() {
  const now = new Date(FIXED_NOW);
  const eng = loadEngine();
  const snap = [
    { id: "e1", date: "2026-03-27", time: "09:00", title: "Ranní schůzka" },
    { id: "e2", date: "2026-03-27", time: "14:00", title: "Oběd s klientem" }
  ];
  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    const r = eng.processUserTurn(c.input, eng.createEmptyDraft(), { now, getEventsSnapshot: () => snap });
    const e = c.expect;
    let ok = r.normalizedIntent === e.ni && r.processingState === e.ps;
    if (e.cr != null) ok = ok && r.clarificationReason === e.cr;
    if (e.date && r.draft) ok = ok && String(r.draft.date).slice(0, 10) === e.date;
    if (e.time && r.draft) ok = ok && String(r.draft.time).slice(0, 5) === e.time;
    if (e.titleHas && r.draft) ok = ok && String(r.draft.title || "").indexOf(e.titleHas) >= 0;
    if (e.titleNot && r.draft) ok = ok && String(r.draft.title || "").indexOf(e.titleNot) < 0;
    if (e.notRead) ok = ok && r.normalizedIntent !== "calendar.read";
    if (e.notStorage) ok = ok && (r.clarificationReason == null) && !String(r.assistantLead || "").includes("kam to chceš uložit");
    if (ok) pass++;
    else fail++;
    console.log(JSON.stringify({ id: c.id, pass: ok }));
    if (!ok) {
      console.log(
        JSON.stringify({
          diff: {
            expected: e,
            actual: {
              normalizedIntent: r.normalizedIntent,
              processingState: r.processingState,
              clarificationReason: r.clarificationReason,
              draft: r.draft
                ? { date: r.draft.date, time: r.draft.time, title: r.draft.title }
                : null,
              assistantLead: r.assistantLead && String(r.assistantLead).slice(0, 120)
            }
          }
        })
      );
    }
  }
  console.log(JSON.stringify({ summary: { total: cases.length, pass, fail, exitCode: fail > 0 ? 1 : 0 } }));
  process.exit(fail > 0 ? 1 : 0);
}

run();
