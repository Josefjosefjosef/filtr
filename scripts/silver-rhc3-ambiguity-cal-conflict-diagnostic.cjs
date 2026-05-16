/**
 * RHC3 cluster diagnostic: rhc3_ambiguity_cal_conflict (read-only engine; scripts-only).
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const APP_JS = path.join(REPO, "assets", "app.js");
const REPORT_JSON = path.join(__dirname, "silver-rhc3-ambiguity-cal-conflict-diagnostic-report.json");

const EXPECTED_MAIN_COMMIT = "d130aa709b9e5ec2c6b28c38980fe94b1b9cf5c4";
const TARGET_CLUSTER = "rhc3_ambiguity_cal_conflict";

const TOTAL_CASES = (() => {
  const n = parseInt(process.env.RHC_V3_TOTAL_CASES || "120000", 10);
  return Number.isFinite(n) && n > 0 ? n : 120000;
})();

const core = require("./rhc-v3-deterministic-core.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const {
  computeGoldLabels,
  finalizeModuleSwitchHarnessEval,
  finalizeModuleSwitchClarifyLaneHarnessEval,
  finalizeNegationNoWriteHarnessEval,
  finalizeNoteQueryKdeHarnessEval,
  finalizeFillerNoteQueryHarnessEval,
  finalizeRetrievalFuzzyHarnessEval,
  finalizeNoteCreateDoPoznamkStorageHarnessEval,
  finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval,
  finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval,
  finalizeAsciiTaskAmbiguousClarifyLaneHarnessEval,
  finalizeAmbiguityCalConflictHarnessEval,
  applyRhc3AmbiguityCalConflictExpectationHarmonization,
  hasAmbiguityCalConflictCanonFolded,
  hasAmbiguityCalConflictLooseCanonFolded
} = rhc3;
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, applyHarnessExpectationHarmonization, ctxForCase, foldCs, hasNegWrite } = harness;

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

function countKey(map, k) {
  map[k] = (map[k] || 0) + 1;
}

function gitStatusShortClean() {
  try {
    const o = execSync("git status --short", { cwd: REPO, encoding: "utf8" }).trim();
    return o ? "NO" : "YES";
  } catch {
    return "UNKNOWN";
  }
}

function classifyAmbiguityCalConflictFail(c, turn, ev) {
  const eng = String(turn.normalizedIntent || "");
  const cat = String(ev.cat || "");
  const fold = foldCs(c.input);
  const gold = c.gold || {};

  if (createLikeTurn(turn)) return { primary: "TRUE_ENGINE_FAIL", sub: "create_like_draft" };
  if (cat === "query_created_write" || cat === "negative_instruction_fail") {
    return { primary: "TRUE_ENGINE_FAIL", sub: cat };
  }
  if (hasNegWrite(fold) && createLikeTurn(turn)) {
    return { primary: "TRUE_ENGINE_FAIL", sub: "write_when_negated" };
  }

  if (cat === "wrong_collection" && eng === "notes.read") {
    if (hasAmbiguityCalConflictLooseCanonFolded(fold) && gold.expected_should_clarify) {
      return { primary: "HARNESS_WRONG_MODULE_LANE", sub: "notes_read_safe_ambiguity" };
    }
    return { primary: "WRONG_MODULE_REAL_BUG", sub: "notes_read_outside_lane" };
  }

  if ((eng === "clarification" || eng === "unknown") && gold.expected_should_clarify) {
    if (String(c.expectedIntent || "") !== "unknown") {
      return { primary: "HARNESS_GOLD_STRICT", sub: "expected_calendar_query_not_unknown" };
    }
    return { primary: "SAFE_CLARIFICATION_OK", sub: "clarify_or_unknown" };
  }

  if (cat === "intent_fail" && (eng === "clarification" || eng === "unknown")) {
    return { primary: "HARNESS_GOLD_STRICT", sub: "intent_fail_clarify" };
  }

  return { primary: "OTHER", sub: cat || "unknown" };
}

function main() {
  let runnerHead = "";
  try {
    runnerHead = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    runnerHead = "UNKNOWN";
  }

  let mainCommitDiag = runnerHead;
  try {
    mainCommitDiag = execSync("git merge-base origin/main HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    try {
      mainCommitDiag = execSync("git rev-parse origin/main", { cwd: REPO, encoding: "utf8" }).trim();
    } catch {
      mainCommitDiag = runnerHead;
    }
  }

  const hashBefore = fs.existsSync(APP_JS) ? sha256File(APP_JS) : "";

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
  applyRhc3AmbiguityCalConflictExpectationHarmonization(cases);
  for (let ci = 0; ci < cases.length; ci++) {
    cases[ci].gold = computeGoldLabels(cases[ci]);
  }

  let dangerousWriteCount = 0;
  let falseWriteCount = 0;
  let queryCreatedWriteCount = 0;
  let writeWhenNegatedCount = 0;

  const primaryCounts = {
    TRUE_ENGINE_FAIL: 0,
    HARNESS_WRONG_MODULE_LANE: 0,
    HARNESS_GOLD_STRICT: 0,
    SAFE_CLARIFICATION_OK: 0,
    WRONG_MODULE_REAL_BUG: 0,
    OTHER: 0
  };
  const subclusterCounts = {};

  const clusterCases = cases.filter((c) => c.cluster === TARGET_CLUSTER);
  const totalClusterCases = clusterCases.length;
  let clusterPass = 0;
  let clusterFailCount = 0;
  let trueEngineFailCount = 0;
  let safeClarificationCount = 0;
  let ambiguityCount = 0;
  let wrongModuleCount = 0;
  let harnessFinalizeWouldPass = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const foldedIn = foldCs(c.input);
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
      ev = finalizeFillerNoteQueryHarnessEval(c, turn, ev);
      ev = finalizeRetrievalFuzzyHarnessEval(c, turn, ev);
      ev = finalizeNoteCreateDoPoznamkStorageHarnessEval(c, turn, ev);
      ev = finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval(c, turn, ev);
      ev = finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval(c, turn, ev);
      ev = finalizeAsciiTaskAmbiguousClarifyLaneHarnessEval(c, turn, ev);
      const evBeforeFinalize = Object.assign({}, ev);
      ev = finalizeAmbiguityCalConflictHarnessEval(c, turn, ev);
      if (!evBeforeFinalize.pass && ev.pass && c.cluster === TARGET_CLUSTER) {
        harnessFinalizeWouldPass++;
      }
    } catch (e) {
      turn = { normalizedIntent: "", processingState: "", draft: {} };
      ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: String(e && e.message) };
    }

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

    if (c.cluster !== TARGET_CLUSTER) continue;

    if (ev.pass) {
      clusterPass++;
      if (String(turn.normalizedIntent || "") === "clarification" || String(turn.normalizedIntent || "") === "unknown") {
        safeClarificationCount++;
      }
    } else {
      clusterFailCount++;
      const eng = String(turn.normalizedIntent || "");
      if (eng === "clarification" || eng === "unknown") safeClarificationCount++;
      if ((c.mutation_mask & core.M.AMBIGUITY_OVERLAY) !== 0) ambiguityCount++;
      if (ev.cat === "wrong_collection") wrongModuleCount++;
      const cls = classifyAmbiguityCalConflictFail(c, turn, ev);
      countKey(primaryCounts, cls.primary);
      countKey(subclusterCounts, cls.sub);
      if (cls.primary === "TRUE_ENGINE_FAIL") trueEngineFailCount++;
    }
  }

  const hashAfter = fs.existsSync(APP_JS) ? sha256File(APP_JS) : "";
  const assetsAppChanged = hashBefore && hashAfter && hashBefore !== hashAfter ? "YES" : "NO";
  if (assetsAppChanged === "YES") {
    console.log("=== RHC3_AMBIGUITY_CAL_CONFLICT_DIAGNOSTIC_ABORT ===");
    console.log("reason=assets_app_js_hash_changed");
    process.exit(1);
  }

  const mustFixEngineCount = primaryCounts.TRUE_ENGINE_FAIL;
  const engineFixRecommended = mustFixEngineCount > 0 ? "YES" : "NO";
  const expectedClarificationCount = clusterCases.filter((cc) => cc.gold && cc.gold.expected_should_clarify).length;

  const textBlock = [
    "=== RHC3_AMBIGUITY_CAL_CONFLICT_DIAGNOSTIC_RESULT ===",
    "main_commit=" + mainCommitDiag,
    "expected_main_commit=" + EXPECTED_MAIN_COMMIT,
    "engine_changed=NO",
    "assets_app_changed=" + assetsAppChanged,
    "total_cluster_cases=" + totalClusterCases,
    "cluster_fail_count=" + clusterFailCount,
    "true_engine_fail_count=" + trueEngineFailCount,
    "must_fix_engine_count=" + mustFixEngineCount,
    "safe_clarification_count=" + safeClarificationCount,
    "ambiguity_count=" + ambiguityCount,
    "expected_clarification_count=" + expectedClarificationCount,
    "wrong_module_count=" + wrongModuleCount,
    "harness_finalize_would_pass=" + harnessFinalizeWouldPass,
    "engine_fix_recommended=" + engineFixRecommended,
    "dangerous_write_count=" + dangerousWriteCount,
    "false_write_count=" + falseWriteCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "write_when_negated_count=" + writeWhenNegatedCount,
    "git_status_clean=" + gitStatusShortClean(),
    "=== END_RHC3_AMBIGUITY_CAL_CONFLICT_DIAGNOSTIC_RESULT ==="
  ].join("\n");

  console.log("\n" + textBlock + "\n");

  const reportObj = {
    generated_at: new Date().toISOString(),
    expected_main_commit: EXPECTED_MAIN_COMMIT,
    main_commit: mainCommitDiag,
    diag_runner_head: runnerHead,
    target_cluster: TARGET_CLUSTER,
    total_cluster_cases: totalClusterCases,
    cluster_pass: clusterPass,
    cluster_fail_count: clusterFailCount,
    true_engine_fail_count: trueEngineFailCount,
    must_fix_engine_count: mustFixEngineCount,
    safe_clarification_count: safeClarificationCount,
    ambiguity_count: ambiguityCount,
    expected_clarification_count: expectedClarificationCount,
    wrong_module_count: wrongModuleCount,
    harness_finalize_would_pass: harnessFinalizeWouldPass,
    engine_fix_recommended: engineFixRecommended,
    primary_bucket_counts: primaryCounts,
    subcluster_counts: subclusterCounts,
    safety: {
      dangerous_write_count: dangerousWriteCount,
      false_write_count: falseWriteCount,
      query_created_write_count: queryCreatedWriteCount,
      write_when_negated_count: writeWhenNegatedCount
    },
    text_block: textBlock
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");
  console.log("report_json=" + REPORT_JSON);
}

main();
