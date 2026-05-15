/**
 * Silver Brain v1.2 — multi-turn conversation follow-ups (local VM, no network).
 * Run: npm run silver-conversation-v12-regression
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

function syncIf(eng, turn, text) {
  if (typeof eng.iuSilverConversationSyncFromTurn === "function") {
    eng.iuSilverConversationSyncFromTurn(turn, text);
  }
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

  eng.iuSilverConversationReset();
  let d = empty;
  let t1 = eng.processUserTurn("Zítra zubař", d, ctx);
  syncIf(eng, t1, "Zítra zubař");
  d = t1.draft;
  const lead1 = String(t1.assistantLead || "");
  step(
    "cal_ask_time",
    t1.normalizedIntent === "calendar.create" &&
      t1.processingState === "NEEDS_CLARIFICATION" &&
      t1.draft &&
      t1.draft.meta &&
      t1.draft.meta.time !== "certain" &&
      (lead1.indexOf("kolik") >= 0 || lead1.indexOf("čas") >= 0)
  );

  let t2 = eng.processUserTurn("v 18", d, ctx);
  syncIf(eng, t2, "v 18");
  step(
    "cal_merge_v18",
    t2.normalizedIntent === "calendar.create" &&
      t2.processingState === "READY_TO_SAVE" &&
      String(t2.draft.date || "") === "2026-03-28" &&
      String(t2.draft.time || "") === "18:00"
  );

  eng.iuSilverConversationReset();
  d = empty;
  let u1 = eng.processUserTurn("Koupit mléko", d, ctx);
  syncIf(eng, u1, "Koupit mléko");
  d = u1.draft;
  step("task_no_due", u1.normalizedIntent === "tasks.create" && !String(d.taskDueAt || "").trim());

  let u2 = eng.processUserTurn("dej to na zítra", d, ctx);
  syncIf(eng, u2, "dej to na zítra");
  step("task_due_tomorrow", u2.normalizedIntent === "tasks.create" && String(u2.draft.taskDueAt || "").slice(0, 10) === "2026-03-28");

  eng.iuSilverConversationReset();
  d = empty;
  let n1 = eng.processUserTurn("ulož poznámku", d, ctx);
  syncIf(eng, n1, "ulož poznámku");
  d = n1.draft;
  step("note_prompt", n1.normalizedIntent === "notes.empty_prompt");

  let n2 = eng.processUserTurn("číslo objednávky 12345", d, ctx);
  syncIf(eng, n2, "číslo objednávky 12345");
  step(
    "note_body",
    n2.normalizedIntent === "notes.create" &&
      String(n2.draft.silverNoteText || "").indexOf("číslo objednávky 12345") >= 0
  );

  eng.iuSilverConversationReset();
  d = empty;
  let a1 = eng.processUserTurn("Praha jedna zítra", d, ctx);
  syncIf(eng, a1, "Praha jedna zítra");
  const ambLead = String(a1.assistantLead || "");
  step(
    "praha_ambiguous",
    a1.normalizedIntent === "create.storage_disambiguation" &&
      ambLead.indexOf("kalendáře") >= 0 &&
      ambLead.indexOf("úkol") >= 0 &&
      ambLead.indexOf("poznámek") >= 0
  );

  const peek = typeof eng.iuSilverConversationPeek === "function" ? eng.iuSilverConversationPeek() : null;
  step("peek_exists", !!peek && "awaitingField" in peek);

  const ent = eng.iuSilverExtractEntities("zítra", now);
  step("entity_still", !!ent && typeof eng.iuSilverExtractEntities === "function");

  const summary = { total: 9, fail, exitCode: fail > 0 ? 1 : 0 };
  console.log(JSON.stringify({ summary }));
  process.exit(summary.exitCode);
}

run();
