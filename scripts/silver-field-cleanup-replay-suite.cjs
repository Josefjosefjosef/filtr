/**
 * Silver field cleanup — replay suite foundation (read-only engine from assets/app.js).
 * Run from repo root: node scripts/silver-field-cleanup-replay-suite.cjs
 *
 * Baseline expectations captured against VM-loaded iuSilverCalendarEngine (fixed clock).
 * Does not modify engine, routing, retrieval, or UI.
 *
 * Cluster coverage (foundation / guard rails before engine title+tail fixes):
 * - calendar_title_temporal_cleanup — three Czech temporal-in-title shapes (inspired by PR #4113 scope).
 * - calendar_location_note_tail_split — three location + note-tail splits (inspired by PR #4112 scope).
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..");
const FIXED_NOW_ISO = "2026-05-04T12:00:00";
const FIXED_NOW = new Date(FIXED_NOW_ISO);
const HARNESS_ID = "silver_field_cleanup_replay_suite_v1";

function readSilverEngineFromApp() {
  const appPath = path.join(REPO, "assets", "app.js");
  const app = fs.readFileSync(appPath, "utf8");
  const m = app.match(/\/\* IU_SILVER_P0_ENGINE_START \*\/([\s\S]*?)\/\* IU_SILVER_P0_ENGINE_END \*\//);
  if (!m) throw new Error("IU_SILVER_P0_ENGINE markers missing");
  return m[1].trim();
}

function loadEngine() {
  const SILVER = readSilverEngineFromApp();
  const ctx = {
    window: {},
    document: {
      readyState: "complete",
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    }
  };
  ctx.window.document = ctx.document;
  ctx.window.localStorage = ctx.localStorage;
  vm.createContext(ctx);
  vm.runInContext(
    SILVER.replace(/document\.readyState/g, '"complete"').replace(/document\.addEventListener\([^)]+\)/g, "void 0"),
    ctx
  );
  return ctx.window.iuSilverCalendarEngine;
}

/** @type {{ id: string, cluster: string, input: string, expectedIntent: string, expect: { processingState: string, title?: string, note?: string, location?: string } }} */
const CASES = [
  {
    id: "NTG_ZAPIS_PETR",
    cluster: "calendar_note_tail_gap_v2",
    input: "Zapiš mi na zítra v 15 schůzku s Petrem a do poznámky hlavně ať nezapomenu smlouvu",
    expectedIntent: "calendar.create",
    expect: {
      processingState: "READY_TO_SAVE",
      title: "Na schůzku s Petrem",
      note: "Hlavně ať nezapomenu smlouvu",
      location: ""
    }
  },
  {
    id: "NTG_HOD_PETR",
    cluster: "calendar_note_tail_gap_v2",
    input: "Hod mi na zítra v 15 schůzku s Petrem a do poznámky poznamenej si deštník",
    expectedIntent: "calendar.create",
    expect: {
      processingState: "READY_TO_SAVE",
      title: "na schůzku s Petrem",
      note: "Poznamenej si deštník",
      location: ""
    }
  },
  {
    id: "NTG_DEJ_PETR",
    cluster: "calendar_note_tail_gap_v2",
    input: "Dej mi do kalendáře na zítra v 15 schůzku s Petrem a do poznámky napiš kontrolu",
    expectedIntent: "calendar.create",
    expect: {
      processingState: "READY_TO_SAVE",
      title: "Na schůzku s Petrem a",
      note: "Napiš kontrolu",
      location: ""
    }
  },
  {
    id: "NTG_MARTIN",
    cluster: "calendar_note_tail_gap_v2",
    input: "Ulož schůzku s Martinem zítra v 10 a do poznámky advokát",
    expectedIntent: "calendar.create",
    expect: {
      processingState: "READY_TO_SAVE",
      title: "Schůzka s Martinem",
      note: "Advokát",
      location: ""
    }
  },
  {
    id: "NTG_JANA",
    cluster: "calendar_note_tail_gap_v2",
    input: "Schůzka s Janou ve čtvrtek v 9 do poznámky napiš rozvod",
    expectedIntent: "calendar.create",
    expect: {
      processingState: "READY_TO_SAVE",
      title: "Schůzka s Janou",
      note: "Napiš rozvod",
      location: ""
    }
  },
  {
    id: "NTG_ADVOKAT_EXPLICIT",
    cluster: "calendar_note_tail_gap_v2",
    input:
      "Do kalendáře na pátek v 11 schůzka s advokátem a explicitně do poznámky napiš že mám přinést občanku",
    expectedIntent: "calendar.create",
    expect: {
      processingState: "READY_TO_SAVE",
      title: "Schůzka s advokátem a explicitně",
      note: "Mám přinést občanku",
      location: ""
    }
  },
  {
    id: "NEG_NEVER_SAVE_CAL",
    cluster: "negative_no_write_guards",
    input: "Nikdy mi neukládej do kalendáře soukromé věci",
    expectedIntent: "clarification",
    expect: { processingState: "CLARIFICATION", title: "", note: "", location: "" }
  },
  {
    id: "NEG_DONT_SAVE_REMEMBER",
    cluster: "negative_no_write_guards",
    input: "Neukládej tohle do kalendáře jen si to pamatuj",
    expectedIntent: "clarification",
    expect: { processingState: "CLARIFICATION", title: "", note: "", location: "" }
  },
  {
    id: "NEG_READ_ONLY_SCHUZKA",
    cluster: "negative_no_write_guards",
    input: "Schůzka zítra v 10 ale neukládej nic jen čti",
    expectedIntent: "calendar.read",
    expect: { processingState: "READ_OK", title: "", note: "", location: "" }
  },
  {
    id: "TEM_KONTROLA_AUTA",
    cluster: "calendar_title_temporal_cleanup",
    input: "Zítra v 9 ráno kontrola auta schůzka v servisu",
    expectedIntent: "calendar.create",
    expect: {
      processingState: "READY_TO_SAVE",
      title: "Kontrola auta schůzka v servisu",
      note: "",
      location: ""
    }
  },
  {
    id: "TEM_NOTAR",
    cluster: "calendar_title_temporal_cleanup",
    input: "Schůzka v pátek odpoledne v 15 u notáře",
    expectedIntent: "calendar.create",
    expect: {
      processingState: "READY_TO_SAVE",
      title: "Schůzka u notáře",
      note: "",
      location: ""
    }
  },
  {
    id: "TEM_UDALOST_TYDEN",
    cluster: "calendar_title_temporal_cleanup",
    input: "Událost příští týden v úterý dopoledne kontrola",
    expectedIntent: "calendar.create",
    expect: {
      processingState: "READY_TO_SAVE",
      title: "Událost týden kontrola",
      note: "",
      location: ""
    }
  },
  {
    id: "LNT_REVOLUCNI",
    cluster: "calendar_location_note_tail_split",
    input: "Meeting v pátek v 9 na adrese Revoluční 1 a do poznámky napiš laptop",
    expectedIntent: "calendar.create",
    expect: {
      processingState: "READY_TO_SAVE",
      title: "Meeting",
      note: "Napiš laptop",
      location: "Revoluční 1"
    }
  },
  {
    id: "LNT_KARLUV_MOST",
    cluster: "calendar_location_note_tail_split",
    input: "Ulož zítra v 13 schůzku na Karlově mostě a do poznámky fotit západ slunce",
    expectedIntent: "calendar.create",
    expect: {
      processingState: "READY_TO_SAVE",
      title: "Schůzka",
      note: "Fotit západ slunce",
      location: "Karlův most Praha"
    }
  },
  {
    id: "LNT_VACLAVAK",
    cluster: "calendar_location_note_tail_split",
    input: "Schůzka zítra v 11 na Václaváku v kavárně a do poznámky donesu vzorky",
    expectedIntent: "calendar.create",
    expect: {
      processingState: "READY_TO_SAVE",
      title: "Schůzka na Václaváku v kavárně",
      note: "Donesu vzorky",
      location: ""
    }
  },
  {
    id: "KEG_PRAVNIK",
    cluster: "calendar_known_event_title_gap",
    input: "Konzultace s právníkem ve středu v 14 na Karlově náměstí",
    expectedIntent: "calendar.create",
    expect: {
      processingState: "READY_TO_SAVE",
      title: "Konzultace s právníkem na Karlově náměstí",
      note: "",
      location: ""
    }
  },
  {
    id: "NSO_VECERE_GLOBAL",
    cluster: "non_schuzka_out_of_scope",
    input: "Jen mi řekni co mám k večeři bez ukládání",
    expectedIntent: "global.search",
    expect: { processingState: "READ_OK", title: "", note: "", location: "" }
  },
  {
    id: "NSO_OBED_TIP",
    cluster: "non_schuzka_out_of_scope",
    input: "Tip na oběd v centru bez rezervace",
    expectedIntent: "clarification",
    expect: { processingState: "CLARIFICATION", title: "", note: "", location: "" }
  },
  {
    id: "NSO_SNIDANE_CLAR",
    cluster: "non_schuzka_out_of_scope",
    input: "Snídaně v Praze kde je dobrá káva",
    expectedIntent: "clarification",
    expect: { processingState: "CLARIFICATION", title: "", note: "", location: "" }
  }
];

function locAddr(draft) {
  if (!draft) return "";
  const a = draft.location != null && String(draft.location).length ? String(draft.location) : "";
  const b = draft.address != null && String(draft.address).length ? String(draft.address) : "";
  return a || b || "";
}

function pad(s, n) {
  const t = String(s == null ? "" : s).replace(/\r?\n/g, "\\n");
  if (t.length <= n) return t + " ".repeat(n - t.length);
  return t.slice(0, n - 1) + "…";
}

function runCase(eng, c) {
  const empty = eng.createEmptyDraft();
  const r = eng.processUserTurn(c.input, empty, { now: FIXED_NOW });
  const actualIntent = String(r.normalizedIntent || "");
  const processingState = String(r.processingState || "");
  const title = String((r.draft && r.draft.title) || "");
  const note = String((r.draft && r.draft.note) || "");
  const location = locAddr(r.draft);
  const exp = c.expect;
  const mismatches = [];
  if (actualIntent !== c.expectedIntent) mismatches.push("intent");
  if (processingState !== exp.processingState) mismatches.push("processingState");
  if (Object.prototype.hasOwnProperty.call(exp, "title") && title !== exp.title) mismatches.push("title");
  if (Object.prototype.hasOwnProperty.call(exp, "note") && note !== exp.note) mismatches.push("note");
  if (Object.prototype.hasOwnProperty.call(exp, "location") && location !== exp.location) mismatches.push("location");
  const pass = mismatches.length === 0;
  const reason = pass ? "OK" : mismatches.join("+");
  return {
    id: c.id,
    cluster: c.cluster,
    input: c.input,
    expectedIntent: c.expectedIntent,
    actualIntent,
    processingState,
    title,
    note,
    location,
    pass,
    reason
  };
}

function main() {
  const eng = loadEngine();
  const rows = [];
  let passCount = 0;
  let failCount = 0;
  for (const c of CASES) {
    const row = runCase(eng, c);
    rows.push(row);
    if (row.pass) passCount++;
    else failCount++;
  }

  const wInput = 44;
  const wIntent = 18;
  const wState = 22;
  const wTitle = 34;
  const wNote = 28;
  const wLoc = 22;
  const wPf = 6;
  const wCluster = 32;

  console.log("=== SILVER_FIELD_CLEANUP_REPLAY_SUITE ===");
  console.log("harness=" + HARNESS_ID + " fixedNow=" + FIXED_NOW_ISO + " cases=" + CASES.length);
  console.log(
    pad("input", wInput) +
      " | " +
      pad("exp_intent", wIntent) +
      " | " +
      pad("act_intent", wIntent) +
      " | " +
      pad("processingState", wState) +
      " | " +
      pad("title", wTitle) +
      " | " +
      pad("note", wNote) +
      " | " +
      pad("location", wLoc) +
      " | " +
      pad("PASS", wPf) +
      " | " +
      pad("cluster", wCluster) +
      " | reason"
  );
  for (const row of rows) {
    console.log(
      pad(row.input, wInput) +
        " | " +
        pad(row.expectedIntent, wIntent) +
        " | " +
        pad(row.actualIntent, wIntent) +
        " | " +
        pad(row.processingState, wState) +
        " | " +
        pad(row.title, wTitle) +
        " | " +
        pad(row.note, wNote) +
        " | " +
        pad(row.location, wLoc) +
        " | " +
        pad(row.pass ? "PASS" : "FAIL", wPf) +
        " | " +
        pad(row.cluster, wCluster) +
        " | " +
        row.reason
    );
  }

  const byCluster = (name) => rows.filter((r) => r.cluster === name);
  const countCluster = (name) => byCluster(name).length;
  const failCluster = (name) => byCluster(name).filter((r) => !r.pass).length;

  console.log(
    JSON.stringify({
      summary: {
        harnessId: HARNESS_ID,
        fixedNow: FIXED_NOW_ISO,
        total: rows.length,
        pass: passCount,
        fail: failCount,
        clusters: {
          calendar_note_tail_gap_v2: { cases: countCluster("calendar_note_tail_gap_v2"), fail: failCluster("calendar_note_tail_gap_v2") },
          calendar_title_temporal_cleanup: { cases: countCluster("calendar_title_temporal_cleanup"), fail: failCluster("calendar_title_temporal_cleanup") },
          calendar_location_note_tail_split: { cases: countCluster("calendar_location_note_tail_split"), fail: failCluster("calendar_location_note_tail_split") },
          calendar_known_event_title_gap: { cases: countCluster("calendar_known_event_title_gap"), fail: failCluster("calendar_known_event_title_gap") },
          non_schuzka_out_of_scope: { cases: countCluster("non_schuzka_out_of_scope"), fail: failCluster("non_schuzka_out_of_scope") },
          negative_no_write_guards: { cases: countCluster("negative_no_write_guards"), fail: failCluster("negative_no_write_guards") }
        },
        exitCode: failCount > 0 ? 1 : 0
      }
    })
  );

  process.exit(failCount > 0 ? 1 : 0);
}

main();
