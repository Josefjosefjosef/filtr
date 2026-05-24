/**
 * SILVER_CAP46_SAVE_MODE_SEMANTIC_PAYLOAD_FINALIZER_V1 — orchestrator + screenshot regression pack.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-save-mode-semantic-payload-finalizer-cap46-report.json");
const CAP_REQUESTED = 46;
const MAIN_BEFORE = process.env.CAP46_MAIN_BEFORE || "a61e371e4f62ce72a371e358f7b96700c957fd1a";

const validator = require("./silver-clean-payload-validator-v1.cjs");
const actionCore = require("./silver-action-mode-v1-core.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const SCREENSHOT_REGRESSION_PACK = [
  {
    id: "S1",
    input:
      "Ulož mi do kalendáře že mám v pondělí schůzku s Pavlíkem máme se potkat dobrovského sady 37 Praha a do poznámky mi napiš že mu mám hodinu předtím zavolat",
    must: {
      module: "calendar.create",
      titleHas: "pavl",
      locHas: "dobrovsk",
      noteHas: "zavolat",
    },
    mustNot: {
      title: ["uloz mi", "do poznamky"],
      loc: [/\s+a$/],
      note: ["do poznamky mi napis"],
    },
  },
  {
    id: "S2",
    input:
      "Silver je ulož mi prosím tě do kalendáře že ve středu musím jít k holiči ve 14 hod. a holiče mám dole na václavském náměstí v Praze a připomeň mi že si sebou mám vzít roušku",
    must: {
      module: "calendar.create",
      titleHas: "holi",
      locHas: "vaclavsk",
      noteHas: "rousk",
      timeCertain: true,
    },
    mustNot: {
      title: ["te ze musim", "vaclavsk", "namesti"],
      note: ["vzit mam vzit", "pripomen mi"],
    },
  },
  {
    id: "S3",
    input:
      "Ulož mi do kalendáře na zítra schůzku s Adelkou v 10 hod. máme se potkat na adrese korunovační 44 Praha a připomeň mi prosím tě že si sebou musím vzít ty smlouvy k tomu novému projektu",
    must: {
      module: "calendar.create",
      titleHas: "adelk",
      locHas: "korunov",
      noteHas: "smlouv",
    },
    mustNot: {
      note: ["vzit musim vzit", "pripomen mi prosim"],
      loc: ["smlouv"],
    },
  },
  {
    id: "S4",
    input:
      "Silver prosím tě ulož mi do kalendáře že mám v pondělí schůzku s Adelkou máme se potkat na Vinohradský ulici v Praze a nesmím si zapomenout vzít sebou fotoaparát",
    must: {
      module: "calendar.create",
      titleHas: "adelk",
      locHas: "vinohrad",
      noteHas: "fotoaparat",
    },
    mustNot: {
      title: ["^mam$"],
      loc: ["nesmim", "zapomenout"],
      note: ["nesmim si zapomenout"],
    },
  },
  {
    id: "S5",
    input:
      "Silver prosím tě ulož mi do kalendáře že mám zítra schůzku v 10 hod. s panem novákem máme se potkat na václavském náměstí v Praze a prosím tě do poznámky mi dej a připomeň mi ať mu koupím po cestě kytky",
    must: {
      module: "calendar.create",
      titleHas: "novak",
      locHas: "vaclavsk",
      noteHas: "kytk",
    },
    mustNot: {
      loc: ["prosim te"],
      note: ["^a pripomen", "do poznamky mi dej"],
    },
  },
];

const GATE_SCRIPTS = [
  "silver-save-mode-reality-test-v1.cjs",
  "audit_silver_20000_routing_stable.cjs",
  "silver-save-mode-final-polish-cap40.cjs",
  "silver-save-understanding-validator-repair-cap30.cjs",
  "silver-clean-save-payload-production-line-v2.cjs",
];

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function fieldFold(s) {
  return foldCs(String(s || ""));
}

function runScreenshotPack(eng) {
  const results = [];
  let pass = 0;
  for (let i = 0; i < SCREENSHOT_REGRESSION_PACK.length; i++) {
    const c = SCREENSHOT_REGRESSION_PACK[i];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase("calendar_write"));
    const title = validator.draftField(turn, "title");
    const loc = validator.draftField(turn, "location");
    const note = validator.draftField(turn, "note");
    const tf = fieldFold(title);
    const lf = fieldFold(loc);
    const nf = fieldFold(note);
    let ok = String(turn.normalizedIntent || "") === c.must.module;
    if (c.must.titleHas && tf.indexOf(fieldFold(c.must.titleHas)) < 0) ok = false;
    if (c.must.locHas && lf.indexOf(fieldFold(c.must.locHas)) < 0) ok = false;
    if (c.must.noteHas && nf.indexOf(fieldFold(c.must.noteHas)) < 0) ok = false;
    if (c.must.timeCertain && !(turn.draft && turn.draft.meta && turn.draft.meta.time === "certain")) ok = false;
    const mn = c.mustNot || {};
    const lists = [
      [mn.title, tf],
      [mn.loc, lf],
      [mn.note, nf],
    ];
    for (let li = 0; li < lists.length; li++) {
      const arr = lists[li][0];
      const hay = lists[li][1];
      if (!arr) continue;
      for (let ai = 0; ai < arr.length; ai++) {
        const needle = arr[ai];
        if (needle instanceof RegExp) {
          if (needle.test(hay)) ok = false;
        } else if (String(needle).charAt(0) === "^") {
          const bare = String(needle).slice(1).replace(/\$$/, "");
          if (hay === fieldFold(bare)) ok = false;
        } else if (hay.indexOf(fieldFold(needle)) >= 0) {
          ok = false;
        }
      }
    }
    if (ok) pass++;
    results.push({ id: c.id, pass: ok, intent: turn.normalizedIntent, title, location: loc, note });
  }
  return { results, pass, total: SCREENSHOT_REGRESSION_PACK.length };
}

function loadRealityMetrics() {
  const p = path.join(__dirname, "silver-save-mode-reality-test-v1-report.json");
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      payload_clean_rate: j.payload_clean_rate,
      semantic_slot_accuracy: j.semantic_slot_accuracy,
      instruction_prefix_in_note: j.instruction_prefix_in_note_count,
      instruction_prefix_in_title: j.instruction_prefix_in_title_count,
      calendar_save_cleanliness: j.calendar_save_accuracy,
      overall_save_accuracy: j.overall_save_accuracy,
    };
  } catch {
    return null;
  }
}

function loadCalendarCleanliness() {
  const p = path.join(__dirname, "silver-calendar-save-payload-cleanliness-audit-v1-report.json");
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return j.cleanliness_rate != null ? j.cleanliness_rate : j.overall_cleanliness;
  } catch {
    return null;
  }
}

function parse20k(stdout) {
  const pick = (re) => {
    const x = stdout.match(re);
    return x ? x[1] : "";
  };
  return {
    overall: pick(/overall_accuracy=(\d+\.?\d*)%/),
    dangerous_write: pick(/dangerous_write_count=(\d+)/),
    false_write: pick(/false_write_count=(\d+)/),
    query_created_write: pick(/query_created_write_count=(\d+)/),
    write_when_negated: pick(/write_when_negated_count=(\d+)/),
    create_without_card: pick(/create_without_card_count=(\d+)/),
    query_with_draft_card: pick(/query_with_draft_card_count=(\d+)/),
  };
}

function runGateScript(name) {
  const p = path.join(__dirname, name);
  if (!fs.existsSync(p)) return { script: name, status: "script_missing", stdout: "" };
  try {
    const env = Object.assign({}, process.env, { REALITY_SKIP_GATES: "1" });
    const stdout = execSync('node "' + p + '"', {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 900000,
      env,
    });
    return { script: name, status: "PASS", stdout };
  } catch (e) {
    return {
      script: name,
      status: "FAIL",
      stdout: String(e.stdout || ""),
      detail: String((e.stderr || e.message || "").slice(0, 300)),
    };
  }
}

function main() {
  const eng = loadEngine();
  const screenshot = runScreenshotPack(eng);
  const gates = GATE_SCRIPTS.map(runGateScript);
  const reality = loadRealityMetrics();
  const calClean = loadCalendarCleanliness();
  const r20 = gates.find((g) => g.script === "audit_silver_20000_routing_stable.cjs");
  const k20 = r20 && r20.stdout ? parse20k(r20.stdout) : {};

  const payloadBefore = 0.9753;
  const semanticBefore = 0.6721;
  const instructionNoteBefore = 210;
  const screenshotBefore = 0;
  const calCleanBefore = 0.85;

  const payloadAfter = reality ? reality.payload_clean_rate : 0;
  const semanticAfter = reality ? reality.semantic_slot_accuracy : 0;
  const instructionNoteAfter = reality ? reality.instruction_prefix_in_note : 9999;
  const screenshotAfter = screenshot.pass / screenshot.total;
  const calCleanAfter = calClean != null ? calClean : payloadAfter;

  const stopFail =
    screenshot.pass !== screenshot.total ||
    k20.dangerous_write !== "0" ||
    k20.false_write !== "0" ||
    k20.query_created_write !== "0" ||
    k20.write_when_negated !== "0" ||
    k20.create_without_card !== "0" ||
    k20.query_with_draft_card !== "0" ||
    k20.overall !== "100" ||
    payloadAfter < payloadBefore - 0.0001 ||
    semanticAfter < semanticBefore - 0.0001 ||
    gates.some((g) => g.status !== "PASS");

  const report = {
    cap_requested: CAP_REQUESTED,
    cap_completed: stopFail ? 45 : 46,
    pass_fail: stopFail ? "FAIL" : "PASS",
    main_commit_before: MAIN_BEFORE,
    main_commit_after: mainCommit(),
    screenshot_regression_pack: screenshot,
    reality,
    gates,
    routing_20k: k20,
    metrics: {
      payload_clean_rate: { before: payloadBefore, after: payloadAfter, delta: payloadAfter - payloadBefore },
      semantic_slot_accuracy: { before: semanticBefore, after: semanticAfter, delta: semanticAfter - semanticBefore },
      instruction_prefix_in_note: {
        before: instructionNoteBefore,
        after: instructionNoteAfter,
        delta: instructionNoteAfter - instructionNoteBefore,
      },
      screenshot_regression_pack: {
        before: screenshotBefore,
        after: screenshotAfter,
        delta: screenshotAfter - screenshotBefore,
      },
      calendar_save_cleanliness: {
        before: calCleanBefore,
        after: calCleanAfter,
        delta: calCleanAfter - calCleanBefore,
      },
    },
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_CAP46_SAVE_MODE_SEMANTIC_PAYLOAD_FINALIZER_V1 ===");
  console.log("payload_clean_rate_before=" + (payloadBefore * 100).toFixed(2) + "%");
  console.log("payload_clean_rate_after=" + (payloadAfter * 100).toFixed(2) + "%");
  console.log("payload_clean_rate_delta=" + ((payloadAfter - payloadBefore) * 100).toFixed(2) + "pp");
  console.log("semantic_slot_accuracy_before=" + (semanticBefore * 100).toFixed(2) + "%");
  console.log("semantic_slot_accuracy_after=" + (semanticAfter * 100).toFixed(2) + "%");
  console.log("semantic_slot_accuracy_delta=" + ((semanticAfter - semanticBefore) * 100).toFixed(2) + "pp");
  console.log("instruction_prefix_in_note_before=" + instructionNoteBefore);
  console.log("instruction_prefix_in_note_after=" + instructionNoteAfter);
  console.log("instruction_prefix_in_note_delta=" + (instructionNoteAfter - instructionNoteBefore));
  console.log("screenshot_regression_pack_before=" + screenshotBefore);
  console.log("screenshot_regression_pack_after=" + screenshotAfter);
  console.log("screenshot_regression_pack_delta=" + (screenshotAfter - screenshotBefore));
  console.log("calendar_save_cleanliness_before=" + (calCleanBefore * 100).toFixed(2) + "%");
  console.log("calendar_save_cleanliness_after=" + (calCleanAfter * 100).toFixed(2) + "%");
  console.log("calendar_save_cleanliness_delta=" + ((calCleanAfter - calCleanBefore) * 100).toFixed(2) + "pp");
  console.log("screenshot_pack_pass=" + screenshot.pass + "/" + screenshot.total);
  console.log("20k_overall_accuracy=" + (k20.overall || "?") + "%");
  console.log("create_without_card_count=" + (k20.create_without_card || "?"));
  console.log("query_with_draft_card_count=" + (k20.query_with_draft_card || "?"));
  console.log("dangerous_write_count=" + (k20.dangerous_write || "?"));
  console.log("false_write_count=" + (k20.false_write || "?"));
  console.log("query_created_write_count=" + (k20.query_created_write || "?"));
  console.log("write_when_negated_count=" + (k20.write_when_negated || "?"));
  console.log("PASS_FAIL=" + report.pass_fail);
  console.log("=== END_SILVER_CAP46_SAVE_MODE_SEMANTIC_PAYLOAD_FINALIZER_V1 ===");

  if (stopFail) process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { main, SCREENSHOT_REGRESSION_PACK };
