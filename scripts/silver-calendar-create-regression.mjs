/**
 * Silver calendar.create regression — deterministic engine checks.
 * Run from repo root: npm run silver-regression
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CORPUS = JSON.parse(fs.readFileSync(path.join(__dirname, "silver-calendar-create-corpus.json"), "utf8"));
function readSilverEngineFromApp() {
  const app = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const m = app.match(/\/\* IU_SILVER_P0_ENGINE_START \*\/([\s\S]*?)\/\* IU_SILVER_P0_ENGINE_END \*\//);
  if (!m) throw new Error("IU_SILVER_P0_ENGINE_START/END markers missing in assets/app.js");
  return m[1].trim();
}
const SILVER = readSilverEngineFromApp();

function sortArr(a) {
  return [...a].map(String).sort();
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
  // Do not strip addEventListener via regex: arrow/listener bodies break `[^)]+` and yield `void 0 => {` (SyntaxError).
  // A no-op addEventListener on ctx.document is enough; listener bodies are not invoked at eval time.
  vm.runInContext(SILVER.replace(/document\.readyState/g, '"complete"'), ctx);
  return ctx.window.iuSilverCalendarEngine;
}

function run() {
  const now = new Date(CORPUS.fixedNow);
  const eng = loadEngine();
  const results = [];
  let pass = 0;
  let fail = 0;

  for (const c of CORPUS.cases) {
    const r = eng.processUserTurn(c.input, eng.createEmptyDraft(), { now });
    const actual = {
      processingState: r.processingState,
      date: r.draft.date || "",
      time: r.draft.time || "",
      title: r.draft.title || "",
      missingFields: sortArr(r.missingFields || [])
    };
    if (Object.prototype.hasOwnProperty.call(c.expect, "note")) {
      actual.note = String(r.draft.note || "");
    }
    if (Object.prototype.hasOwnProperty.call(c.expect, "location")) {
      actual.location = String(r.draft.location || r.draft.address || "");
    }
    const exp = {
      processingState: c.expect.processingState,
      date: c.expect.date || "",
      time: c.expect.time || "",
      title: c.expect.title || "",
      missingFields: sortArr(c.expect.missingFields || [])
    };
    if (Object.prototype.hasOwnProperty.call(c.expect, "note")) {
      exp.note = String(c.expect.note || "");
    }
    if (Object.prototype.hasOwnProperty.call(c.expect, "location")) {
      exp.location = String(c.expect.location || "");
    }
    const ok =
      actual.processingState === exp.processingState &&
      actual.date === exp.date &&
      actual.time === exp.time &&
      actual.title === exp.title &&
      JSON.stringify(actual.missingFields) === JSON.stringify(exp.missingFields) &&
      (!Object.prototype.hasOwnProperty.call(c.expect, "note") || actual.note === exp.note) &&
      (!Object.prototype.hasOwnProperty.call(c.expect, "location") || actual.location === exp.location);
    if (ok) pass++;
    else fail++;
    results.push({
      id: c.id,
      group: c.group,
      pass: ok,
      input: c.input,
      expected: exp,
      actual,
      diff: ok
        ? null
        : {
            processingState: actual.processingState === exp.processingState ? null : { expected: exp.processingState, actual: actual.processingState },
            date: actual.date === exp.date ? null : { expected: exp.date, actual: actual.date },
            time: actual.time === exp.time ? null : { expected: exp.time, actual: actual.time },
            title: actual.title === exp.title ? null : { expected: exp.title, actual: actual.title },
            missingFields:
              JSON.stringify(actual.missingFields) === JSON.stringify(exp.missingFields)
                ? null
                : { expected: exp.missingFields, actual: actual.missingFields }
          }
    });
    console.log(JSON.stringify({ case: c.id, pass: ok }));
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

  /** P0 PR #4008: real multi-intent — calendar.create (head) + notes.create (tail), not event note only. */
  const DUAL_NOW = new Date("2026-05-06T12:00:00");
  const dualIn =
    "Ulož mi schůzku ve středu s Tomášem na adrese Korunní 44 Praha do poznámky mi dej abych si sebou vzal deštník";
  const dualR = eng.processUserTurn(dualIn, eng.createEmptyDraft(), { now: DUAL_NOW });
  const comp = !!dualR.silverCompanionNoteTurn;
  const noteTxt = String((dualR.silverCompanionNoteTurn && dualR.silverCompanionNoteTurn.draft && dualR.silverCompanionNoteTurn.draft.silverNoteText) || "").toLowerCase();
  const calNote = String((dualR.draft && dualR.draft.note) || "").toLowerCase();
  const dualOk =
    dualR.normalizedIntent === "calendar.create" &&
    comp &&
    (noteTxt.indexOf("deštník") >= 0 || noteTxt.indexOf("destnik") >= 0) &&
    calNote.indexOf("deštník") < 0 &&
    calNote.indexOf("destnik") < 0;
  console.log(JSON.stringify({ case: "REAL_MULTI_INTENT_CAL_NOTE_SPLIT", pass: dualOk }));
  const exitDual = dualOk ? 0 : 1;
  process.exit(summary.exitCode !== 0 ? summary.exitCode : exitDual);
}

run();
