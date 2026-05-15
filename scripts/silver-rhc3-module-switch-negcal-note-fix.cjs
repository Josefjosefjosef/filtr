/**
 * RHC3 narrow engine fix replay (rhc3_module_switch_cal_to_note):
 * - Replays full RHC3 corpus, isolates target cluster, reports before/after counts.
 * - Runs must-pass cases (negated calendar + clear note target → notes.create or safe clarification).
 * - Runs protection cases (must NOT regress strong calendar/task/read paths).
 * - Computes safety counters across full corpus (must remain zero).
 * - Read-only on engine; deterministic.
 *
 * Usage:
 *   node scripts/silver-rhc3-module-switch-negcal-note-fix.cjs
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const APP_JS = path.join(REPO, "assets", "app.js");
const REPORT_JSON = path.join(__dirname, "silver-rhc3-module-switch-negcal-note-fix-report.json");
const TRIAGE_REPORT_JSON = path.join(__dirname, "silver-rhc3-module-switch-triage-report.json");

const TARGET_CLUSTER = "rhc3_module_switch_cal_to_note";

const TOTAL_CASES = (() => {
  const n = parseInt(process.env.RHC_V3_TOTAL_CASES || "6800", 10);
  return Number.isFinite(n) && n > 0 ? n : 6800;
})();

const core = require("./rhc-v3-deterministic-core.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const {
  computeGoldLabels,
  finalizeModuleSwitchHarnessEval,
  finalizeModuleSwitchClarifyLaneHarnessEval,
  finalizeNegationNoWriteHarnessEval,
  finalizeNoteQueryKdeHarnessEval,
  finalizeNoteCreateDoPoznamkStorageHarnessEval,
  finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval
} = rhc3;
const { classifyFailure } = require("./silver-rhc3-top-cluster-diagnostic.cjs");

const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const {
  loadEngine,
  evaluateOne,
  applyHarnessExpectationHarmonization,
  ctxForCase,
  foldCs,
  hasNegWrite
} = harness;

function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function safetyNoWriteFolded(fold) {
  return (
    /\bnic\s+neuklad\w*\b/i.test(fold) ||
    /\bnevytvarej\b/i.test(fold) ||
    /\bnevytvářej\b/i.test(fold) ||
    /\bpouze\s+cti\b/i.test(fold) ||
    /\bpouze\s+čti\b/i.test(fold) ||
    /\bjen\s+se\s+podivej\b/i.test(fold) ||
    /\bjen\s+se\s+podívej\b/i.test(fold) ||
    /\bneukladat\b/i.test(fold) ||
    /\bneukládat\b/i.test(fold)
  );
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function gitStatusShort() {
  try {
    return execSync("git status --short", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "ERR";
  }
}

function getMainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "UNKNOWN";
  }
}

function getCurrentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "UNKNOWN";
  }
}

function evaluateCase(eng, c) {
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
  } catch (e) {
    turn = { normalizedIntent: "", processingState: "", draft: {} };
    ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: String(e && e.message) };
  }
  return { turn, ev };
}

function classifyAfter(c, turn, ev) {
  const g = c.gold || {};
  return classifyFailure(c, turn, ev, g);
}

const MUST_PASS_CASES = [
  "hele ulož mi poznámku že PIN je doma, ne do kalendáře",
  "prosím tě zapiš poznámku že klíče jsou v šuplíku, ne do kalendare",
  "počkej ne kalendář, dej to do poznámky: právník volat zítra",
  "nechci to v kalendáři, jen poznámka: auto má servis",
  "ne do kalendáře prosím, poznamka že faktura je zaplacená",
  "hele ulož mi do poznámek že PIN je doma, ale ne nějak do kalendáře",
  "ulož mi narozeniny tety, ale ne trochu do kalendáře, do poznámek",
  "vlastně Ulož mi číslo smlouvy, ale ne no do kalendáře, do poznámek",
  "Uloz mi udaje k bance, ale ne trochu do kalendare, do poznamek",
  "no jo Ulož mi heslo k WiFi, ale ne nějak do kalendáře, do poznámek"
];

const PROTECTION_CASES = [
  { input: "zapiš mi do kalendáře zítra schůzku s právníkem", mustNot: "notes.create", expectFamily: "calendar" },
  { input: "ulož poznámku že PIN je doma", mustNot: "calendar.create", expectFamily: "notes" },
  { input: "nic neukládej, jen si přečti poznámky", mustNot: "calendar.create", noWrite: true },
  { input: "jen čti, neukládej nic do poznámek", mustNot: "calendar.create", noWrite: true },
  { input: "přidej úkol zavolat právníkovi, ne do kalendáře", mustNot: "calendar.create", expectFamily: "tasks" },
  { input: "co mám v kalendáři zítra", mustNot: "calendar.create", expectFamily: "calendar_read" },
  { input: "co mám v poznámkách o právníkovi", mustNot: "calendar.create", expectFamily: "notes_read" }
];

function runCustomCase(eng, input, ctxName) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch {}
  try {
    return eng.processUserTurn(input, eng.createEmptyDraft(), ctxForCase(ctxName || "note_write"));
  } catch (e) {
    return { normalizedIntent: "", processingState: "", draft: {}, _err: String(e && e.message) };
  }
}

function turnIsCreate(turn) {
  return turn && (turn.normalizedIntent === "calendar.create" || turn.normalizedIntent === "tasks.create" || turn.normalizedIntent === "notes.create");
}

function main() {
  const hashBefore = fs.existsSync(APP_JS) ? sha256File(APP_JS) : "";

  const triageBefore = readJsonSafe(TRIAGE_REPORT_JSON);
  const beforeMain = triageBefore ? String(triageBefore.main_commit || "") : "";
  const beforeCluster = triageBefore && triageBefore.cluster_fail != null ? Number(triageBefore.cluster_fail) : null;
  const beforeBuckets = triageBefore && triageBefore.internal_bucket_counts ? triageBefore.internal_bucket_counts : {};
  const beforeTrueEngine = beforeBuckets.TRUE_ENGINE_FAIL_MODULE_SWITCH != null ? Number(beforeBuckets.TRUE_ENGINE_FAIL_MODULE_SWITCH) : null;
  const beforeWrongModule = beforeBuckets.WRONG_MODULE_REAL_BUG != null ? Number(beforeBuckets.WRONG_MODULE_REAL_BUG) : null;
  const beforeAmbiguous = triageBefore && triageBefore.user_partition && triageBefore.user_partition.ambiguous_input_count != null ? Number(triageBefore.user_partition.ambiguous_input_count) : null;
  const beforeHarness = triageBefore && triageBefore.user_partition && triageBefore.user_partition.harness_problem_count != null ? Number(triageBefore.user_partition.harness_problem_count) : null;

  let beforeCalendarLeak = null;
  if (triageBefore && Array.isArray(triageBefore.top_subclusters)) {
    let leak = 0;
    for (let i = 0; i < triageBefore.top_subclusters.length; i++) {
      const lab = String(triageBefore.top_subclusters[i].label || "");
      if (/eng=calendar\.create/.test(lab) && /neg_cal_surface=1/.test(lab) && /note=1/.test(lab)) {
        leak += Number(triageBefore.top_subclusters[i].count || 0);
      }
    }
    beforeCalendarLeak = leak;
  }

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const cases = rhc3.buildCorpus(TOTAL_CASES);
  applyHarnessExpectationHarmonization(cases);
  for (let ci = 0; ci < cases.length; ci++) {
    cases[ci].gold = computeGoldLabels(cases[ci]);
  }
  for (let sji = 0; sji < cases.length; sji++) {
    const sj = cases[sji];
    if (sj.family === "module_switching" && sj.gold) {
      sj.expectedIntent = sj.gold.expected_intent;
    }
  }

  let dangerousWriteCount = 0;
  let falseWriteCount = 0;
  let queryCreatedWriteCount = 0;
  let writeWhenNegatedCount = 0;
  let p0SafetyExpectedNoWriteButDraft = 0;

  let clusterTotal = 0;
  let clusterPass = 0;
  let clusterFail = 0;
  let calendarLeakAfter = 0;

  const internalAfter = {
    TRUE_ENGINE_FAIL_MODULE_SWITCH: 0,
    GOLD_LABEL_TOO_AGGRESSIVE: 0,
    TEMPLATE_DNA_BAD_INPUT: 0,
    SAFETY_NEGATION_CONFLICT: 0,
    AMBIGUITY_SHOULD_CLARIFY: 0,
    ENGINE_SAFE_CLARIFICATION_OK: 0,
    WRONG_MODULE_REAL_BUG: 0,
    OTHER: 0
  };

  let trueEngineAfter = 0;
  let wrongModuleAfter = 0;
  let harnessAfter = 0;
  let ambiguousAfter = 0;

  const exampleFails = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const foldedIn = foldCs(c.input);
    const { turn, ev } = evaluateCase(eng, c);

    const createLike = createLikeTurn(turn);
    if (safetyNoWriteFolded(foldedIn) && createLike) {
      p0SafetyExpectedNoWriteButDraft++;
    }
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

    if (c.cluster !== TARGET_CLUSTER) continue;
    clusterTotal++;

    const eng0 = String(turn.normalizedIntent || "");
    const isCalCreate = eng0 === "calendar.create";
    const hasNegCalSurface =
      /\bne\s+do\s+kalend/i.test(foldedIn) ||
      /\bne\s+v\s+kalend/i.test(foldedIn) ||
      /\bne\s+\S+\s+do\s+kalend/i.test(foldedIn) ||
      /\bne\s+kalend/i.test(foldedIn) ||
      /\bkalend\w*\s+ne\b/i.test(foldedIn) ||
      /\bmimo\s+kalend/i.test(foldedIn);
    const hasNoteSurface = /\bdo\s+poznam/i.test(foldedIn) || /\bpoznamk/i.test(foldedIn);
    if (isCalCreate && hasNegCalSurface && hasNoteSurface) calendarLeakAfter++;

    if (ev.pass) {
      clusterPass++;
      continue;
    }
    clusterFail++;
    const internal = classifyAfter(c, turn, ev);
    internalAfter[internal] = (internalAfter[internal] || 0) + 1;
    if (internal === "TRUE_ENGINE_FAIL_MODULE_SWITCH") trueEngineAfter++;
    if (internal === "WRONG_MODULE_REAL_BUG") wrongModuleAfter++;
    if (internal === "GOLD_LABEL_TOO_AGGRESSIVE" || internal === "SAFETY_NEGATION_CONFLICT") harnessAfter++;
    const expInt = String(c.gold && c.gold.expected_intent || "");
    if (expInt === "unknown") ambiguousAfter++;

    if (exampleFails.length < 12) {
      exampleFails.push({
        id: c.id,
        input: c.input.slice(0, 200),
        bucket: internal,
        eng: eng0,
        ps: String(turn.processingState || "")
      });
    }
  }

  const fixedCount = beforeCluster != null ? Math.max(0, beforeCluster - clusterFail) : null;

  const mustPassResults = [];
  let mustPassPass = 0;
  let mustPassFail = 0;
  let mustPassCalendarCreate = 0;
  for (let i = 0; i < MUST_PASS_CASES.length; i++) {
    const inp = MUST_PASS_CASES[i];
    const t = runCustomCase(eng, inp, "note_write");
    const eng0 = String(t.normalizedIntent || "");
    const ps0 = String(t.processingState || "");
    const isCalCreate = eng0 === "calendar.create";
    const okIntent = !isCalCreate;
    const isNotesCreate = eng0 === "notes.create" && ps0 === "READY_TO_SAVE";
    const isClarifyOrUnknown = eng0 === "clarification" || eng0 === "unknown";
    const accepted = isNotesCreate || isClarifyOrUnknown;
    if (isCalCreate) mustPassCalendarCreate++;
    if (okIntent && accepted) mustPassPass++;
    else mustPassFail++;
    mustPassResults.push({ input: inp, eng: eng0, ps: ps0, isCalendarCreate: isCalCreate, accepted: !!(okIntent && accepted) });
  }

  const protectionResults = [];
  let protectionPass = 0;
  let protectionFail = 0;
  for (let i = 0; i < PROTECTION_CASES.length; i++) {
    const c = PROTECTION_CASES[i];
    const t = runCustomCase(eng, c.input, c.expectFamily === "tasks" ? "task_write" : (c.expectFamily === "calendar" ? "calendar_write" : "note_query"));
    const eng0 = String(t.normalizedIntent || "");
    const ps0 = String(t.processingState || "");
    let ok = true;
    let reason = "";
    if (c.mustNot && eng0 === c.mustNot) {
      ok = false;
      reason = "produced_forbidden_intent_" + eng0;
    }
    if (c.noWrite && turnIsCreate(t)) {
      ok = false;
      reason = "no_write_negation_violated_eng_" + eng0;
    }
    if (c.expectFamily === "calendar" && eng0 !== "calendar.create" && ps0 !== "READY_TO_SAVE" && ps0 !== "NEEDS_CLARIFICATION") {
      ok = false;
      reason = "expected_calendar_path_got_" + eng0;
    }
    if (c.expectFamily === "tasks" && eng0 !== "tasks.create" && eng0 !== "task.create") {
      ok = false;
      reason = "expected_task_path_got_" + eng0;
    }
    if (c.expectFamily === "notes" && eng0 !== "notes.create" && !(eng0 === "create.storage_disambiguation")) {
      ok = false;
      reason = "expected_note_path_got_" + eng0;
    }
    if (c.expectFamily === "calendar_read" && eng0 !== "calendar.read" && eng0 !== "clarification" && eng0 !== "unknown") {
      ok = false;
      reason = "expected_calendar_read_got_" + eng0;
    }
    if (c.expectFamily === "notes_read" && eng0 !== "notes.read" && eng0 !== "note.query" && eng0 !== "clarification" && eng0 !== "unknown" && eng0 !== "global.search") {
      ok = false;
      reason = "expected_notes_read_got_" + eng0;
    }
    if (ok) protectionPass++;
    else protectionFail++;
    protectionResults.push({ input: c.input, eng: eng0, ps: ps0, ok, reason });
  }

  const hashAfter = fs.existsSync(APP_JS) ? sha256File(APP_JS) : "";
  const assetsAppHashChanged = hashBefore && hashAfter && hashBefore !== hashAfter ? "YES" : "NO";

  const safetyAllZero =
    dangerousWriteCount === 0 &&
    falseWriteCount === 0 &&
    queryCreatedWriteCount === 0 &&
    writeWhenNegatedCount === 0 &&
    p0SafetyExpectedNoWriteButDraft === 0;

  const mainCommit = getMainCommit();
  const branch = getCurrentBranch();
  const gitClean = gitStatusShort() === "" ? "YES" : "NO";

  const reportObj = {
    generated_at: new Date().toISOString(),
    branch,
    main_commit: mainCommit,
    main_before: beforeMain,
    target_cluster: TARGET_CLUSTER,
    total_cluster_cases: clusterTotal,
    cluster_pass_after: clusterPass,
    cluster_fail_after: clusterFail,
    cluster_fail_before: beforeCluster,
    fixed_count: fixedCount,
    calendar_create_leak_before: beforeCalendarLeak,
    calendar_create_leak_after: calendarLeakAfter,
    bucket_after: internalAfter,
    true_engine_fail_before: beforeTrueEngine,
    true_engine_fail_after: trueEngineAfter,
    wrong_module_real_bug_before: beforeWrongModule,
    wrong_module_real_bug_after: wrongModuleAfter,
    ambiguous_input_count_before: beforeAmbiguous,
    ambiguous_input_count_after: ambiguousAfter,
    harness_problem_count_before: beforeHarness,
    harness_problem_count_after: harnessAfter,
    safety: {
      dangerous_write_count: dangerousWriteCount,
      false_write_count: falseWriteCount,
      query_created_write_count: queryCreatedWriteCount,
      write_when_negated_count: writeWhenNegatedCount,
      p0_safety_expected_no_write_but_draft: p0SafetyExpectedNoWriteButDraft,
      safety_all_zero: safetyAllZero
    },
    must_pass: {
      total: MUST_PASS_CASES.length,
      pass: mustPassPass,
      fail: mustPassFail,
      calendar_create_count: mustPassCalendarCreate,
      results: mustPassResults
    },
    protection: {
      total: PROTECTION_CASES.length,
      pass: protectionPass,
      fail: protectionFail,
      results: protectionResults
    },
    git_status_clean: gitClean,
    assets_app_hash_changed_during_run: assetsAppHashChanged,
    examples_remaining_fails: exampleFails
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  const lines = [
    "=== RHC3_NEGCAL_NOTE_FIX_REPLAY ===",
    "main_commit=" + mainCommit,
    "branch=" + branch,
    "main_before=" + beforeMain,
    "total_cluster_cases=" + clusterTotal,
    "cluster_fail_before=" + (beforeCluster == null ? "n/a" : beforeCluster),
    "cluster_fail_after=" + clusterFail,
    "fixed_count=" + (fixedCount == null ? "n/a" : fixedCount),
    "calendar_create_leak_before=" + (beforeCalendarLeak == null ? "n/a" : beforeCalendarLeak),
    "calendar_create_leak_after=" + calendarLeakAfter,
    "true_engine_fail_before=" + (beforeTrueEngine == null ? "n/a" : beforeTrueEngine),
    "true_engine_fail_after=" + trueEngineAfter,
    "wrong_module_real_bug_before=" + (beforeWrongModule == null ? "n/a" : beforeWrongModule),
    "wrong_module_real_bug_after=" + wrongModuleAfter,
    "harness_problem_count_after=" + harnessAfter,
    "ambiguous_input_count_after=" + ambiguousAfter,
    "dangerous_write_count=" + dangerousWriteCount,
    "false_write_count=" + falseWriteCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "write_when_negated_count=" + writeWhenNegatedCount,
    "must_pass_total=" + MUST_PASS_CASES.length,
    "must_pass_pass=" + mustPassPass,
    "must_pass_fail=" + mustPassFail,
    "must_pass_calendar_create_count=" + mustPassCalendarCreate,
    "protection_total=" + PROTECTION_CASES.length,
    "protection_pass=" + protectionPass,
    "protection_fail=" + protectionFail,
    "git_status_clean=" + gitClean,
    "assets_app_hash_changed_during_run=" + assetsAppHashChanged,
    "=== END_RHC3_NEGCAL_NOTE_FIX_REPLAY ==="
  ].join("\n");

  console.log("\n" + lines + "\n");

  const ok =
    safetyAllZero &&
    mustPassCalendarCreate === 0 &&
    protectionFail === 0 &&
    (beforeCluster == null || clusterFail <= beforeCluster) &&
    (beforeCalendarLeak == null || calendarLeakAfter <= beforeCalendarLeak);
  if (!ok) process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { TARGET_CLUSTER };
