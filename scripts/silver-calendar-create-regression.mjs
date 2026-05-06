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

  /** P0 embedded event note: calendar.create + event draft.note; žádný samostatný notes.create companion. */
  const DUAL_NOW = new Date("2026-05-06T12:00:00");
  const dualIn =
    "Ulož mi schůzku ve středu s Tomášem na adrese Korunní 44 Praha do poznámky mi dej abych si sebou vzal deštník";
  const dualR = eng.processUserTurn(dualIn, eng.createEmptyDraft(), { now: DUAL_NOW });
  const comp = !!dualR.silverCompanionNoteTurn;
  const calNote = String((dualR.draft && dualR.draft.note) || "").toLowerCase();
  const dualOk =
    dualR.normalizedIntent === "calendar.create" &&
    !comp &&
    (calNote.indexOf("deštník") >= 0 || calNote.indexOf("destnik") >= 0);
  console.log(JSON.stringify({ case: "REAL_MULTI_INTENT_CAL_NOTE_SPLIT", pass: dualOk }));
  const exitDual = dualOk ? 0 : 1;

  /** P0 real mobile v1 — doplněné produkční věty (kalendář + adresace + připomenutí + dual-write). */
  const RM_NOW = new Date("2026-03-27T12:00:00");
  const rmZel =
    "Ulož mi ve čtvrtek schůzku s panem Zelenkou na adrese Praha jedna vinohradská a do poznámky mi dej ať si připravím smlouvu";
  const rmZR = eng.processUserTurn(rmZel, eng.createEmptyDraft(), { now: RM_NOW });
  const zOk =
    rmZR.normalizedIntent === "calendar.create" &&
    !rmZR.silverCompanionNoteTurn &&
    String((rmZR.draft && rmZR.draft.note) || "")
      .toLowerCase()
      .indexOf("smlouv") >= 0 &&
    String((rmZR.draft && rmZR.draft.address) || "").toLowerCase().indexOf("vinohrad") >= 0;
  console.log(JSON.stringify({ case: "REAL_MULTI_INTENT_ZELENKA_CAL_NOTE", pass: zOk }));

  const rmW = "Kdy mi končí záruka TV";
  const rmWR = eng.processUserTurn(rmW, eng.createEmptyDraft(), { now: RM_NOW });
  const wOk =
    rmWR.normalizedIntent === "notes.read" &&
    rmWR.processingState === "READ_OK" &&
    !/\bkalend/i.test(String(rmWR.assistantLead || rmWR.userFacingSummary || "").toLowerCase());
  console.log(JSON.stringify({ case: "REAL_MOBILE_WARRANTY_NOTE_QUERY", pass: wOk }));

  const rmT1 = "Nesmím zapomenout napsat do knihy úvodní kapitolu";
  const rmT1R = eng.processUserTurn(rmT1, eng.createEmptyDraft(), { now: RM_NOW });
  const t1Ok = rmT1R.normalizedIntent === "tasks.create" && rmT1R.processingState === "READY_TO_SAVE";
  console.log(JSON.stringify({ case: "REAL_MOBILE_NESMIM_NAPSAT_TASK", pass: t1Ok }));

  const rmT2 = "Nesmím zapomenout zaplatit nájem do pátku";
  const rmT2R = eng.processUserTurn(rmT2, eng.createEmptyDraft(), { now: RM_NOW });
  const t2Ok = rmT2R.normalizedIntent === "tasks.create" && rmT2R.processingState === "READY_TO_SAVE";
  console.log(JSON.stringify({ case: "REAL_MOBILE_NESMIM_ZAPLATIT_TASK", pass: t2Ok }));

  const exitRm = zOk && wOk && t1Ok && t2Ok ? 0 : 1;
  const exitFinal = summary.exitCode !== 0 ? summary.exitCode : exitDual !== 0 ? exitDual : exitRm;
  process.exit(exitFinal);
}

run();
