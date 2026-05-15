/**
 * RHC3 narrow replay: rhc3_task_query_slice read-vs-create (tasks.create leak on task.query chaos).
 * Runs harnessed corpus slice + must-pass / protection strings; writes JSON report.
 *
 * Usage:
 *   node scripts/silver-rhc3-task-query-read-vs-create-fix.cjs
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const APP_JS = path.join(REPO, "assets", "app.js");
const REPORT_JSON = path.join(__dirname, "silver-rhc3-task-query-read-vs-create-fix-report.json");
const SLICE_DIAG_REPORT = path.join(__dirname, "silver-rhc3-task-query-slice-diagnostic-report.json");

const TARGET_CLUSTER = "rhc3_task_query_slice";

const TOTAL_CASES = (() => {
  const n = parseInt(process.env.RHC_V3_TOTAL_CASES || "120000", 10);
  return Number.isFinite(n) && n > 0 ? n : 120000;
})();

const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const {
  computeGoldLabels,
  finalizeModuleSwitchHarnessEval,
  finalizeModuleSwitchClarifyLaneHarnessEval,
  finalizeNegationNoWriteHarnessEval,
  finalizeNoteQueryKdeHarnessEval,
  finalizeNoteCreateDoPoznamkStorageHarnessEval,
  finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval,
  finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval
} = rhc3;
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, applyHarnessExpectationHarmonization, ctxForCase, foldCs, hasNegWrite } = harness;

function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function countKey(map, k) {
  map[k] = (map[k] || 0) + 1;
}

/** Minimal subcluster counter aligned with slice diagnostic intent_fail + task.query + drafty. */
function isQuerySurfaceRoutedToCreate(c, turn, ev) {
  if (ev.pass) return false;
  const exp = String(c.expectedIntent || c.gold?.expected_intent || "");
  if (exp !== "task.query") return false;
  return createLikeTurn(turn);
}

const MUST_PASS_READ = [
  "co mám v úkolech",
  "co mam v ukolech",
  "jaké mám úkoly",
  "jake mam ukoly",
  "ukaž mi úkoly",
  "ukaz mi ukoly",
  "co mám dneska za úkoly",
  "co mam dneska za ukoly",
  "najdi úkol kolem právníka",
  "najdi ukol kolem pravnika",
  "co mám s právníkem",
  "co mam s pravnikem",
  "hele tyjo co mám v úkolech ohledně smlouvy",
  "vole co mam v ukolech prostě",
  "mám něco v úkolech",
  "mam neco v ukolech",
  "úkoly ohledně právníka",
  "ukoly ohledne pravnika",
  "nic neukládej, jen se podívej do úkolů",
  "jen čti úkoly, nic nevytvářej"
];

const PROTECTION_CREATE_OR_READ = [
  { input: "dej do úkolů zavolat právníkovi", allowCreate: true },
  { input: "hoď do úkolů koupit mléko", allowCreate: true },
  { input: "přidej úkol zaplatit fakturu", allowCreate: true },
  { input: "do úkolů vyzvednout balík", allowCreate: true },
  { input: "ulož mi úkol zavolat mámě", allowCreate: true },
  { input: "co mám v kalendáři zítra", mustNotCreate: true, allowCalendarRead: true },
  { input: "co mám v poznámkách o právníkovi", mustNotCreate: true, allowNotesRead: true }
];

function evalHarnessedTurn(eng, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch {}
  const empty = eng.createEmptyDraft();
  let turn;
  let ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: "" };
  try {
    turn = eng.processUserTurn(c.input, empty, ctxForCase(c.group));
    ev = evaluateOne(c, turn);
    ev = finalizeModuleSwitchHarnessEval(c, turn, ev);
    ev = finalizeModuleSwitchClarifyLaneHarnessEval(c, turn, ev);
    ev = finalizeNegationNoWriteHarnessEval(c, turn, ev);
    ev = finalizeNoteQueryKdeHarnessEval(c, turn, ev);
    ev = finalizeNoteCreateDoPoznamkStorageHarnessEval(c, turn, ev);
    ev = finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval(c, turn, ev);
    ev = finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval(c, turn, ev);
  } catch (e) {
    turn = { normalizedIntent: "", processingState: "", draft: {} };
    ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: String(e && e.message) };
  }
  return { turn, ev };
}

function main() {
  const sliceBefore = readJsonSafe(SLICE_DIAG_REPORT);
  const beforeClusterFail = sliceBefore && sliceBefore.cluster_fail_count != null ? Number(sliceBefore.cluster_fail_count) : null;
  const beforeSub = sliceBefore && sliceBefore.subcluster_counts ? sliceBefore.subcluster_counts : {};
  const beforeQueryToCreate =
    beforeSub["query_surface_routed_to_create"] != null ? Number(beforeSub["query_surface_routed_to_create"]) : null;

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const cases = rhc3.buildCorpus(TOTAL_CASES);
  if (cases.length !== TOTAL_CASES) {
    console.log("seed_data_fail=expected_" + TOTAL_CASES + "_got_" + cases.length);
    process.exit(1);
  }
  applyHarnessExpectationHarmonization(cases);
  for (let ci = 0; ci < cases.length; ci++) {
    cases[ci].gold = computeGoldLabels(cases[ci]);
    cases[ci].expectedIntent = cases[ci].gold.expected_intent;
  }

  let dangerousWriteCount = 0;
  let falseWriteCount = 0;
  let queryCreatedWriteCount = 0;
  let writeWhenNegatedCount = 0;

  let clusterPass = 0;
  let clusterFailCount = 0;
  const subclusterCounts = {};
  let querySurfaceRoutedToCreate = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (c.cluster !== TARGET_CLUSTER) continue;
    const foldedIn = foldCs(c.input);
    const { turn, ev } = evalHarnessedTurn(eng, c);
    const createLike = createLikeTurn(turn);
    if (
      !ev.pass &&
      c.group.indexOf("query") >= 0 &&
      (ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail")
    ) {
      falseWriteCount++;
    }
    if (ev.cat === "query_created_write") queryCreatedWriteCount++;
    if (hasNegWrite(foldedIn) && createLike) writeWhenNegatedCount++;
    const caseDangerous =
      ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail" || (hasNegWrite(foldedIn) && createLike);
    if (caseDangerous) dangerousWriteCount++;

    if (ev.pass) {
      clusterPass++;
    } else {
      clusterFailCount++;
      if (isQuerySurfaceRoutedToCreate(c, turn, ev)) {
        querySurfaceRoutedToCreate++;
        countKey(subclusterCounts, "query_surface_routed_to_create");
      } else {
        countKey(subclusterCounts, String(ev.cat || "other_fail"));
      }
    }
  }

  const mustPassFail = [];
  for (let mi = 0; mi < MUST_PASS_READ.length; mi++) {
    const input = MUST_PASS_READ[mi];
    const fake = {
      input,
      group: "task_query",
      family: "task_query_chaos",
      cluster: TARGET_CLUSTER,
      expectedIntent: "task.query",
      meta: {}
    };
    const { turn } = evalHarnessedTurn(eng, fake);
    const bad = turn.normalizedIntent === "tasks.create" || turn.processingState === "READY_TO_SAVE";
    if (bad) mustPassFail.push({ input, ni: turn.normalizedIntent, ps: turn.processingState });
  }

  const protectionFail = [];
  for (let pi = 0; pi < PROTECTION_CREATE_OR_READ.length; pi++) {
    const row = PROTECTION_CREATE_OR_READ[pi];
    let grp = "task_write";
    let exp = "task.create";
    if (row.allowCalendarRead) {
      grp = "calendar_query";
      exp = "calendar.query";
    } else if (row.allowNotesRead) {
      grp = "note_query";
      exp = "note.query";
    }
    const fake = { input: row.input, group: grp, family: "manual_protection", cluster: "manual", expectedIntent: exp, meta: {} };
    const { turn } = evalHarnessedTurn(eng, fake);
    const ni = String(turn.normalizedIntent || "");
    const ps = String(turn.processingState || "");
    if (row.allowCreate) {
      if (ni !== "tasks.create" && ps !== "READY_TO_SAVE") {
        protectionFail.push({ input: row.input, ni, ps });
      }
    }
    if (row.mustNotCreate && ni === "tasks.create") {
      protectionFail.push({ input: row.input, ni, ps });
    }
  }

  const report = {
    target_cluster: TARGET_CLUSTER,
    total_cases_scanned: TOTAL_CASES,
    cluster_pass: clusterPass,
    cluster_fail_count: clusterFailCount,
    query_surface_routed_to_create: querySurfaceRoutedToCreate,
    subcluster_counts: subclusterCounts,
    dangerous_write_count: dangerousWriteCount,
    false_write_count: falseWriteCount,
    query_created_write_count: queryCreatedWriteCount,
    write_when_negated_count: writeWhenNegatedCount,
    diagnostic_report_before: {
      cluster_fail_count: beforeClusterFail,
      query_surface_routed_to_create: beforeQueryToCreate
    },
    must_pass_read_failures: mustPassFail,
    protection_failures: protectionFail,
    app_js_sha256: fs.existsSync(APP_JS) ? sha256File(APP_JS) : "",
    git_head: (() => {
      try {
        return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
      } catch {
        return "UNKNOWN";
      }
    })()
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  console.log("=== RHC3_TASK_QUERY_READ_VS_CREATE_FIX_REPLAY ===");
  console.log("target_cluster=" + TARGET_CLUSTER);
  console.log("cluster_fail_count=" + clusterFailCount);
  console.log("query_surface_routed_to_create=" + querySurfaceRoutedToCreate);
  console.log("dangerous_write_count=" + dangerousWriteCount);
  console.log("must_pass_read_fail_count=" + mustPassFail.length);
  console.log("protection_fail_count=" + protectionFail.length);
  console.log("report_json=" + REPORT_JSON);
  console.log("=== END_REPLAY ===");

  if (mustPassFail.length > 0 || protectionFail.length > 0) process.exit(1);
  process.exit(0);
}

main();
