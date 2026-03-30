/**
 * Silver calendar.read regression — deterministic read pipeline.
 * Run: npm run silver-read-regression
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CORPUS = JSON.parse(fs.readFileSync(path.join(__dirname, "silver-calendar-read-corpus.json"), "utf8"));
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

function resolveEvents(ev) {
  if (ev === "default") return CORPUS.eventsDefault;
  return Array.isArray(ev) ? ev : [];
}

function run() {
  const now = new Date(CORPUS.fixedNow);
  const eng = loadEngine();
  let pass = 0;
  let fail = 0;

  for (const c of CORPUS.intentCases) {
    const r = eng.processUserTurn(c.input, eng.createEmptyDraft(), { now, getEventsSnapshot: () => CORPUS.eventsDefault });
    const ok = r.normalizedIntent === c.expectNormalizedIntent;
    if (ok) pass++;
    else fail++;
    console.log(JSON.stringify({ case: c.id, group: "intent", pass: ok }));
    if (!ok) {
      console.log(JSON.stringify({ diff: { expected: c.expectNormalizedIntent, actual: r.normalizedIntent } }));
    }
  }

  for (const c of CORPUS.readCases) {
    const events = resolveEvents(c.events);
    const pr = eng.calendarReadProbe(c.input, { now, events });
    const exp = c.expect;
    const q = pr.query;
    const ans = pr.answer;
    const ok =
      pr.detectedIntent === "calendar.read" &&
      q &&
      q.intent === exp.queryIntent &&
      ans &&
      ans.count === exp.count &&
      ans.type === exp.type &&
      ans.ambiguity === exp.ambiguity;
    if (ok) pass++;
    else fail++;
    console.log(JSON.stringify({ case: c.id, group: "read", pass: ok }));
    if (!ok) {
      console.log(
        JSON.stringify({
          diff: {
            input: c.input,
            expected: exp,
            actual: {
              detectedIntent: pr.detectedIntent,
              queryIntent: q && q.intent,
              count: ans && ans.count,
              type: ans && ans.type,
              ambiguity: ans && ans.ambiguity
            }
          }
        })
      );
    }
  }

  const total = CORPUS.intentCases.length + CORPUS.readCases.length;
  const summary = { contractVersion: CORPUS.contractVersion, fixedNow: CORPUS.fixedNow, total, pass, fail, exitCode: fail > 0 ? 1 : 0 };
  console.log(JSON.stringify({ summary }));
  process.exit(summary.exitCode);
}

run();
