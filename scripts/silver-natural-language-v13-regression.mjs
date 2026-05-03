/**
 * Silver Brain v1.3 — natural time phrases + příští weekday + za X + smart prompts (VM).
 * Run: npm run silver-natural-language-v13-regression
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
  const now = new Date("2026-03-27T12:00:00");
  const eng = loadEngine();
  const empty = eng.createEmptyDraft();
  const ctx = { now, getEventsSnapshot: () => [] };
  let fail = 0;

  function step(name, ok) {
    if (!ok) fail++;
    console.log(JSON.stringify({ step: name, pass: !!ok }));
  }

  const t1 = eng.processUserTurn("Zítra ráno zubař", empty, ctx);
  step(
    "morning_zubar_ready",
    t1.normalizedIntent === "calendar.create" &&
      t1.processingState === "READY_TO_SAVE" &&
      String(t1.draft.date || "") === "2026-03-28" &&
      String(t1.draft.time || "") === "09:00"
  );

  const t2 = eng.processUserTurn("Příští pondělí meeting v 9", empty, ctx);
  step(
    "next_mon_meeting",
    t2.normalizedIntent === "calendar.create" &&
      t2.processingState === "READY_TO_SAVE" &&
      String(t2.draft.date || "") === "2026-04-06" &&
      String(t2.draft.time || "") === "09:00" &&
      /meeting/i.test(String(t2.draft.title || ""))
  );

  const t3 = eng.processUserTurn("Za hodinu schůzka", empty, ctx);
  step(
    "za_hodinu_cal",
    t3.normalizedIntent === "calendar.create" &&
      t3.processingState === "READY_TO_SAVE" &&
      String(t3.draft.date || "") === "2026-03-27" &&
      String(t3.draft.time || "") === "13:00"
  );

  const t4 = eng.processUserTurn("Za 2 hodiny zavolat", empty, ctx);
  step(
    "za_2h_task",
    t4.normalizedIntent === "tasks.create" &&
      t4.processingState === "READY_TO_SAVE" &&
      String(t4.draft.taskDueAt || "").slice(0, 10) === "2026-03-27" &&
      /zavolat/i.test(String(t4.draft.title || ""))
  );

  const t5 = eng.processUserTurn("Praha jedna večer", empty, ctx);
  const lead5 = String(t5.assistantLead || "");
  step(
    "praha_vecer_disambig",
    t5.normalizedIntent === "create.storage_disambiguation" &&
      t5.storageDisambiguation === true &&
      (lead5.indexOf("Kam") >= 0 || lead5.indexOf("kalendáře") >= 0)
  );

  const t6 = eng.processUserTurn("Zítra v 18", empty, ctx);
  const lead6 = String(t6.assistantLead || "");
  step(
    "smart_title_prompt",
    t6.normalizedIntent === "calendar.create" &&
      t6.processingState === "NEEDS_CLARIFICATION" &&
      lead6.indexOf("Co přesně") >= 0 &&
      String(t6.draft.time || "") === "18:00"
  );

  const ent = eng.iuSilverExtractEntities("Zítra večer zubař", now);
  step(
    "entity_evening",
    ent.timeHHMM === "18:00" && String(ent.timeLabel || "").indexOf("več") >= 0
  );

  const milk = eng.processUserTurn("Koupit mléko", empty, ctx);
  step("task_milk_no_extra", milk.normalizedIntent === "tasks.create" && milk.processingState === "READY_TO_SAVE");

  console.log(JSON.stringify({ summary: { total: 8, fail, exitCode: fail > 0 ? 1 : 0 } }));
  process.exit(fail > 0 ? 1 : 0);
}

run();
