/**
 * Silver Brain v1.4 — session memory + multi-turn follow-ups (local VM, no network).
 * Run: npm run silver-session-memory-v14-regression
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
  let t1 = eng.processUserTurn("Koupit mléko", d, ctx);
  syncIf(eng, t1, "Koupit mléko");
  d = t1.draft;
  let t2 = eng.processUserTurn("a rohlíky", d, ctx);
  syncIf(eng, t2, "a rohlíky");
  const t2title = String(t2.draft && t2.draft.title ? t2.draft.title : "").toLowerCase();
  step(
    "multi_step_new_task",
    t2.normalizedIntent === "tasks.create" &&
      t2title.indexOf("rohl") >= 0 &&
      t2title.indexOf("mléko") < 0
  );

  eng.iuSilverConversationReset();
  d = empty;
  let u1 = eng.processUserTurn("Koupit mléko", d, ctx);
  syncIf(eng, u1, "Koupit mléko");
  d = u1.draft;
  let u2 = eng.processUserTurn("dej to na zítra", d, ctx);
  syncIf(eng, u2, "dej to na zítra");
  step("task_update_due", u2.normalizedIntent === "tasks.create" && String(u2.draft.taskDueAt || "").slice(0, 10) === "2026-03-28");

  eng.iuSilverConversationReset();
  d = empty;
  let c1 = eng.processUserTurn("Zítra zubař v 18", d, ctx);
  syncIf(eng, c1, "Zítra zubař v 18");
  d = c1.draft;
  let c2 = eng.processUserTurn("v Praze jedna", d, ctx);
  syncIf(eng, c2, "v Praze jedna");
  const loc = String((c2.draft && (c2.draft.location || c2.draft.address)) || "");
  step("calendar_location_followup", c2.normalizedIntent === "calendar.create" && loc.indexOf("Praha 1") >= 0);

  eng.iuSilverConversationReset();
  d = empty;
  let n1 = eng.processUserTurn("ulož poznámku číslo objednávky 123", d, ctx);
  syncIf(eng, n1, "ulož poznámku číslo objednávky 123");
  d = n1.draft;
  let n2 = eng.processUserTurn("a že je to z Alzy", d, ctx);
  syncIf(eng, n2, "a že je to z Alzy");
  const noteText = String(n2.draft && n2.draft.silverNoteText ? n2.draft.silverNoteText : "");
  step(
    "note_append",
    n2.normalizedIntent === "notes.create" && noteText.indexOf("123") >= 0 && noteText.toLowerCase().indexOf("alz") >= 0
  );

  eng.iuSilverConversationReset();
  d = empty;
  let z1 = eng.processUserTurn("Zítra zubař v 18", d, ctx);
  syncIf(eng, z1, "Zítra zubař v 18");
  d = z1.draft;
  let amb = eng.processUserTurn("Praha jedna", d, ctx);
  syncIf(eng, amb, "Praha jedna");
  const peek = typeof eng.iuSilverConversationPeek === "function" ? eng.iuSilverConversationPeek() : {};
  step(
    "context_cleared_on_ambiguous",
    amb.normalizedIntent === "clarification" &&
      amb.clarificationReason === "ambiguous_request" &&
      !peek.lastDraft
  );

  const apply = typeof eng.iuSilverApplySessionContext === "function" ? eng.iuSilverApplySessionContext : null;
  const sess = { lastDateISO: "2026-04-01", lastTimeHHMM: "10:00", lastLocation: "Praha 2", lastTitle: "X" };
  const emptyD = eng.createEmptyDraft();
  const merged = apply ? apply(emptyD, sess) : null;
  step(
    "apply_session_helper",
    !!merged &&
      String(merged.date || "") === "2026-04-01" &&
      String(merged.time || "") === "10:00" &&
      String(merged.location || "").indexOf("Praha 2") >= 0
  );

  const ent = eng.iuSilverExtractEntities("v Praze jedna", now);
  step("entity_v_praze", !!(ent && ent.locationNormalized === "Praha 1"));

  const summary = { total: 8, fail, exitCode: fail > 0 ? 1 : 0 };
  console.log(JSON.stringify({ summary }));
  process.exit(summary.exitCode);
}

run();
