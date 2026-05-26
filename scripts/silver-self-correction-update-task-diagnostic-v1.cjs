#!/usr/bin/env node
/**
 * SILVER_SELF_CORRECTION_UPDATE_TASK_DIAGNOSTIC_V1 — cluster triage (scripts only).
 * Target: self_correction_update_task — harness/gold vs true engine bug.
 *
 * Usage: node scripts/silver-self-correction-update-task-diagnostic-v1.cjs
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-self-correction-update-task-diagnostic-v1-report.json");
const CLUSTER = "self_correction_update_task";

const scAudit = require("./silver-self-correction-audit.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");

const {
  loadEngine,
  evaluateOne,
  applyHarnessExpectationHarmonization,
  ctxForCase,
  foldCs,
} = harness;

const { countsAsSafetyNegationWriteLeak } = require("./silver-self-correction-negation-scope.cjs");

const {
  finalizeSelfCorrectionNoisyNegReadHarnessEval,
  finalizeSelfCorrectionSafetyCalReadonlyHarnessEval,
  finalizeSelfCorrectionSafetyNoteReadonlyHarnessEval,
  finalizeSelfCorrectionNegationFlipHarnessEval,
  finalizeSelfCorrectionNoisyCalHarnessEval,
  finalizeSelfCorrectionAfterCreateTaskHarnessEval,
  finalizeSelfCorrectionUpdateNoteHarnessEval,
  finalizeSelfCorrectionUpdateTaskHarnessEval,
  updateTaskHarnessCueFolded,
  updateTaskEditLeadFolded,
  isSelfCorrectionUpdateTaskHarnessCase,
  safeUpdateTaskOutcome,
} = require("./silver-self-correction-query-clarification.cjs");

const {
  computeGoldLabels,
  finalizeModuleSwitchHarnessEval,
  finalizeModuleSwitchClarifyLaneHarnessEval,
  finalizeModuleSwitchTaskToNoteHarnessEval,
  finalizeModuleSwitchNoteToCalHarnessEval,
  finalizeModuleSwitchCalToNoteHarnessEval,
  finalizeModuleSwitchNegJakoCalToNoteHarnessEval,
  finalizeNegationNoWriteHarnessEval,
  finalizeNoteQueryKdeHarnessEval,
  finalizeFillerNoteQueryHarnessEval,
  finalizeRetrievalFuzzyHarnessEval,
  finalizeNoteCreateDoPoznamkStorageHarnessEval,
  finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval,
  finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval,
  finalizeAsciiTaskAmbiguousClarifyLaneHarnessEval,
  finalizeAmbiguityCalConflictHarnessEval,
  finalizeCalQueryTopicClarifyLaneHarnessEval,
  finalizeMobileVoiceCalHarnessEval,
} = rhc3;

function createLikeTurn(turn) {
  const ps = String(turn.processingState || "");
  const eng = String(turn.normalizedIntent || "");
  return (
    ps === "READY_TO_SAVE" ||
    eng === "calendar.create" ||
    eng === "tasks.create" ||
    eng === "notes.create"
  );
}

function applyHarnessFinalizers(c, turn, ev) {
  let out = ev;
  out = finalizeModuleSwitchHarnessEval(c, turn, out);
  out = finalizeModuleSwitchClarifyLaneHarnessEval(c, turn, out);
  out = finalizeModuleSwitchTaskToNoteHarnessEval(c, turn, out);
  out = finalizeModuleSwitchNoteToCalHarnessEval(c, turn, out);
  out = finalizeModuleSwitchCalToNoteHarnessEval(c, turn, out);
  out = finalizeModuleSwitchNegJakoCalToNoteHarnessEval(c, turn, out);
  out = finalizeNegationNoWriteHarnessEval(c, turn, out);
  out = finalizeNoteQueryKdeHarnessEval(c, turn, out);
  out = finalizeFillerNoteQueryHarnessEval(c, turn, out);
  out = finalizeRetrievalFuzzyHarnessEval(c, turn, out);
  out = finalizeNoteCreateDoPoznamkStorageHarnessEval(c, turn, out);
  out = finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval(c, turn, out);
  out = finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval(c, turn, out);
  out = finalizeAsciiTaskAmbiguousClarifyLaneHarnessEval(c, turn, out);
  out = finalizeAmbiguityCalConflictHarnessEval(c, turn, out);
  out = finalizeCalQueryTopicClarifyLaneHarnessEval(c, turn, out);
  out = finalizeMobileVoiceCalHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionNoisyNegReadHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionSafetyCalReadonlyHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionSafetyNoteReadonlyHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionNegationFlipHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionNoisyCalHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionAfterCreateTaskHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionUpdateNoteHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionUpdateTaskHarnessEval(c, turn, out);
  return out;
}

function auditFailBucket(c, turn, ev, gold) {
  const fold = foldCs(c.input);
  const drafty = createLikeTurn(turn);
  const cat = String(ev.cat || "");

  if (cat === "runtime_fail") return "OTHER";

  if (
    drafty &&
    gold &&
    !gold.expected_should_write &&
    (gold.expected_safety === "read_only" || c.sc_lane === "safety_regression" || c.sc_lane === "correction_negation")
  ) {
    return "TRUE_ENGINE_FAIL";
  }
  if (cat === "query_created_write" || cat === "negative_instruction_fail" || cat === "write_when_negated") {
    return "TRUE_ENGINE_FAIL";
  }
  if (countsAsSafetyNegationWriteLeak(fold, c) && drafty) return "TRUE_ENGINE_FAIL";

  if (cat === "intent_fail" && (turn.normalizedIntent === "clarification" || turn.normalizedIntent === "unknown")) {
    if (gold && gold.expected_should_clarify) return "AMBIGUOUS_INPUT";
    if (
      c.cluster === "self_correction_update_task" &&
      !drafty &&
      (turn.normalizedIntent === "clarification" ||
        turn.normalizedIntent === "unknown" ||
        turn.normalizedIntent === "create.storage_disambiguation")
    ) {
      return "HARNESS_PROBLEM";
    }
    return "AMBIGUOUS_INPUT";
  }

  if (cat === "intent_fail" || cat === "wrong_collection" || cat === "calendar_vs_task_confusion") {
    if (c.cluster === "self_correction_update_task" && !drafty) return "HARNESS_PROBLEM";
    if (c.sc_lane === "correction_update_vs_create" && drafty) return "TRUE_ENGINE_FAIL";
    return "TRUE_ENGINE_FAIL";
  }

  if (cat === "false_negative" || cat === "unnecessary_disambiguation") return "HARNESS_PROBLEM";

  return "HARNESS_PROBLEM";
}

function main() {
  let mainCommit = "unknown";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    /* ignore */
  }

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("=== SILVER_SELF_CORRECTION_UPDATE_TASK_DIAGNOSTIC_V1 ===");
    console.log("PASS_FAIL=FAIL");
    console.log("runtime_fail=" + String(e && e.message));
    console.log("=== END_SILVER_SELF_CORRECTION_UPDATE_TASK_DIAGNOSTIC_V1 ===");
    process.exit(1);
  }

  const totalCases = scAudit.TOTAL_CASES;
  const allCases = scAudit.buildScCorpus(totalCases);
  applyHarnessExpectationHarmonization(allCases);
  const cases = allCases.filter(function (c) {
    return String(c.cluster || "") === CLUSTER;
  });

  for (let ci = 0; ci < cases.length; ci++) {
    cases[ci].gold = computeGoldLabels(cases[ci]);
  }

  const buckets = {};
  const fails = [];
  let passCount = 0;
  let failCount = 0;
  let cueMiss = 0;
  let harnessWouldFix = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch {
      /* ignore */
    }
    let turn;
    try {
      turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    } catch (e) {
      failCount++;
      const root = "true_engine_bug";
      buckets[root] = (buckets[root] || 0) + 1;
      if (fails.length < 30) {
        fails.push({
          input: c.input,
          expected: c.expectedIntent,
          actual: "runtime_fail",
          normalizedIntent: "",
          actionMode: "",
          processingState: "",
          write_happened: false,
          root_cause: root,
          harness_cue: updateTaskHarnessCueFolded(foldCs(c.input)),
          engine_acceptable: false,
        });
      }
      continue;
    }

    const fold = foldCs(c.input);
    if (!updateTaskHarnessCueFolded(fold)) cueMiss++;

    let ev = evaluateOne(c, turn);
    const beforeFinal = ev.pass;
    ev = applyHarnessFinalizers(c, turn, ev);
    if (!beforeFinal && ev.pass) harnessWouldFix++;

    const auditBucket = ev.pass ? "PASS" : auditFailBucket(c, turn, ev, c.gold);
    const rootMap = {
      PASS: "pass",
      TRUE_ENGINE_FAIL: "true_engine_bug",
      HARNESS_PROBLEM: "harness_problem",
      AMBIGUOUS_INPUT: "ambiguity",
      OTHER: "replay_expectation_problem",
    };
    const root = rootMap[auditBucket] || "harness_problem";
    buckets[root] = (buckets[root] || 0) + 1;

    if (ev.pass) {
      passCount++;
    } else {
      failCount++;
      if (fails.length < 30) {
        fails.push({
          input: c.input,
          expected: c.expectedIntent,
          actual: ev.auditIntent || turn.normalizedIntent,
          normalizedIntent: turn.normalizedIntent,
          actionMode: turn.actionMode || "",
          processingState: turn.processingState,
          write_happened: createLikeTurn(turn),
          update_requested: !!(c.meta && c.meta.preferUpdate),
          audit_bucket: auditBucket,
          root_cause: root,
          fail_cat: ev.cat,
          harness_cue: updateTaskHarnessCueFolded(fold),
          edit_lead: updateTaskEditLeadFolded(fold),
          safe_clarification: safeUpdateTaskOutcome(turn),
          engine_acceptable:
            !createLikeTurn(turn) &&
            (safeUpdateTaskOutcome(turn) ||
              turn.normalizedIntent === "tasks.read" ||
              turn.normalizedIntent === "task.query"),
          gold_too_strict: !!(c.gold && c.gold.expected_should_write && !createLikeTurn(turn)),
        });
      }
    }
  }

  const trueEngine = buckets.true_engine_bug || 0;
  const harness = buckets.harness_problem || 0;
  const gold = buckets.gold_label_problem || 0;
  const ambiguity = buckets.ambiguity || 0;
  const safeClar = buckets.safe_clarification || 0;
  const replay = buckets.replay_expectation_problem || 0;
  const stale = buckets.stale_report_problem || 0;

  const rep = {
    harness_id: "silver_self_correction_update_task_diagnostic_v1",
    generated_at: new Date().toISOString(),
    main_commit: mainCommit,
    cluster: CLUSTER,
    cases_total: cases.length,
    pass_count: passCount,
    fail_count: failCount,
    top_cluster: CLUSTER + ":" + failCount,
    true_engine_bug_count: trueEngine,
    harness_problem_count: harness,
    gold_label_problem_count: gold,
    ambiguity_count: ambiguity,
    safe_clarification_count: safeClar,
    expected_unknown_count: buckets.expected_unknown || 0,
    replay_expectation_problem_count: replay,
    stale_report_problem_count: stale,
    harness_cue_miss_count: cueMiss,
    harness_would_fix_count: harnessWouldFix,
    root_cause_buckets: buckets,
    ready_for_engine_fix: trueEngine > 0 ? "YES" : "NO",
    ready_for_harness_alignment: harness + gold + replay + safeClar > 0 ? "YES" : "NO",
    ready_for_report_sync: stale > 0 ? "YES" : "NO",
    safety_risk: trueEngine > 0 && fails.some(function (f) {
      return f.write_happened && f.root_cause === "true_engine_bug";
    }) ? "YES" : "NO",
    broad_refactor_needed: "NO",
    assets_app_changed: "NO",
    engine_changed: "NO",
    fail_samples: fails,
    PASS_FAIL: failCount === 0 ? "PASS" : "FAIL",
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2), "utf8");

  console.log("=== SILVER_SELF_CORRECTION_UPDATE_TASK_DIAGNOSTIC_V1 ===");
  console.log("main_commit=" + mainCommit);
  console.log("cluster=" + CLUSTER);
  console.log("cases_total=" + rep.cases_total);
  console.log("pass_count=" + rep.pass_count);
  console.log("fail_count=" + rep.fail_count);
  console.log("true_engine_bug_count=" + rep.true_engine_bug_count);
  console.log("harness_problem_count=" + rep.harness_problem_count);
  console.log("gold_label_problem_count=" + rep.gold_label_problem_count);
  console.log("ambiguity_count=" + rep.ambiguity_count);
  console.log("safe_clarification_count=" + rep.safe_clarification_count);
  console.log("replay_expectation_problem_count=" + rep.replay_expectation_problem_count);
  console.log("harness_cue_miss_count=" + rep.harness_cue_miss_count);
  console.log("harness_would_fix_count=" + rep.harness_would_fix_count);
  console.log("ready_for_engine_fix=" + rep.ready_for_engine_fix);
  console.log("ready_for_harness_alignment=" + rep.ready_for_harness_alignment);
  console.log("ready_for_report_sync=" + rep.ready_for_report_sync);
  console.log("safety_risk=" + rep.safety_risk);
  console.log("broad_refactor_needed=" + rep.broad_refactor_needed);
  console.log("PASS_FAIL=" + rep.PASS_FAIL);
  console.log("report=" + REPORT_JSON);
  console.log("=== END_SILVER_SELF_CORRECTION_UPDATE_TASK_DIAGNOSTIC_V1 ===");
}

main();
