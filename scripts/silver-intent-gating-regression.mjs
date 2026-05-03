/**
 * Silver explicit intent gating — processUserTurn contract.
 * Run: npm run silver-intent-regression
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CORPUS = JSON.parse(fs.readFileSync(path.join(__dirname, "silver-intent-gating-corpus.json"), "utf8"));

/** Shorthand expected → full processUserTurn contract (silver-intent-gating-corpus.json). */
function expandExpectedShorthand(expected) {
  const e = String(expected || "").trim();
  const table = {
    "calendar.create": { normalizedIntent: "calendar.create", processingState: "READY_TO_SAVE", clarificationReason: null },
    "task.create": { normalizedIntent: "tasks.create", processingState: "READY_TO_SAVE", clarificationReason: null },
    "note.create": { normalizedIntent: "notes.create", processingState: "READY_TO_SAVE", clarificationReason: null },
    unknown: { normalizedIntent: "clarification", processingState: "CLARIFICATION", clarificationReason: "ambiguous_request" }
  };
  if (!table[e]) throw new Error("Unknown expected shorthand: " + e);
  return table[e];
}
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
  const now = new Date(CORPUS.fixedNow);
  const eng = loadEngine();
  let pass = 0;
  let fail = 0;

  for (const c of CORPUS.cases) {
    const r = eng.processUserTurn(c.input, eng.createEmptyDraft(), { now, getEventsSnapshot: () => [] });
    const exp = c.expect || expandExpectedShorthand(c.expected);
    const ok =
      r.normalizedIntent === exp.normalizedIntent &&
      r.processingState === exp.processingState &&
      (exp.clarificationReason == null ? r.clarificationReason == null : r.clarificationReason === exp.clarificationReason);
    if (ok) pass++;
    else fail++;
    console.log(JSON.stringify({ case: c.id, pass: ok }));
    if (!ok) {
      console.log(
        JSON.stringify({
          diff: {
            expected: exp,
            actual: {
              normalizedIntent: r.normalizedIntent,
              processingState: r.processingState,
              clarificationReason: r.clarificationReason
            }
          }
        })
      );
    }
  }

  const summary = {
    contractVersion: CORPUS.contractVersion,
    fixedNow: CORPUS.fixedNow,
    total: CORPUS.cases.length,
    pass,
    fail,
    exitCode: fail > 0 ? 1 : 0
  };
  console.log(JSON.stringify({ summary }));
  process.exit(summary.exitCode);
}

run();
