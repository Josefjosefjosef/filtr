#!/usr/bin/env node
/**
 * SILVER_SELF_CORRECTION_TASK_SURFACE_HARNESS_ALIGNMENT_V1
 * Triage remaining self_correction_update_task surface fails (harness/gold vs engine).
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-self-correction-task-surface-harness-alignment-v1-report.json");
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

const {
  finalizeSelfCorrectionUpdateTaskHarnessEval,
  updateTaskHarnessCueFolded,
  safeUpdateTaskOutcome,
} = require("./silver-self-correction-query-clarification.cjs");

const { computeGoldLabels } = rhc3;

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

function classifyFail(c, turn, ev) {
  const fold = foldCs(c.input);
  if (createLikeTurn(turn)) return "true_engine_bug";
  if (!updateTaskHarnessCueFolded(fold) && safeUpdateTaskOutcome(turn)) return "harness_problem";
  if (c.gold && c.gold.expected_should_write && !createLikeTurn(turn)) return "gold_label_problem";
  if (safeUpdateTaskOutcome(turn)) return "safe_clarification";
  if (turn.normalizedIntent === "unknown") return "expected_unknown";
  return "harness_problem";
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
    console.log("=== SILVER_SELF_CORRECTION_TASK_SURFACE_HARNESS_ALIGNMENT_V1 ===");
    console.log("PASS_FAIL=FAIL");
    console.log("runtime_fail=" + String(e && e.message));
    console.log("=== END_SILVER_SELF_CORRECTION_TASK_SURFACE_HARNESS_ALIGNMENT_V1 ===");
    process.exit(1);
  }

  const allCases = scAudit.buildScCorpus(scAudit.TOTAL_CASES);
  applyHarnessExpectationHarmonization(allCases);
  const cases = allCases.filter(function (c) {
    return String(c.cluster || "") === CLUSTER;
  });
  for (let ci = 0; ci < cases.length; ci++) {
    cases[ci].gold = computeGoldLabels(cases[ci]);
  }

  const buckets = {};
  let passCount = 0;
  let failCount = 0;
  let calendarCreateLeak = 0;
  let writeLeak = 0;

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
    } catch {
      failCount++;
      buckets.true_engine_bug = (buckets.true_engine_bug || 0) + 1;
      continue;
    }
    if (turn.normalizedIntent === "calendar.create") calendarCreateLeak++;
    if (createLikeTurn(turn)) writeLeak++;

    let ev = evaluateOne(c, turn);
    ev = finalizeSelfCorrectionUpdateTaskHarnessEval(c, turn, ev);
    if (ev.pass) {
      passCount++;
      buckets.pass = (buckets.pass || 0) + 1;
    } else {
      failCount++;
      const root = classifyFail(c, turn, ev);
      buckets[root] = (buckets[root] || 0) + 1;
    }
  }

  const rep = {
    harness_id: "silver_self_correction_task_surface_harness_alignment_v1",
    generated_at: new Date().toISOString(),
    main_commit: mainCommit,
    cluster: CLUSTER,
    cases_total: cases.length,
    pass_count: passCount,
    fail_count: failCount,
    harness_problem_count: buckets.harness_problem || 0,
    gold_label_problem_count: buckets.gold_label_problem || 0,
    true_engine_bug_count: buckets.true_engine_bug || 0,
    safe_clarification_count: buckets.safe_clarification || 0,
    expected_unknown_count: buckets.expected_unknown || 0,
    calendar_create_leak_count: calendarCreateLeak,
    write_leak_count: writeLeak,
    root_cause_buckets: buckets,
    fix_type: "scripts_only_harness_alignment",
    replay_guard: "silver-self-correction-update-task-guard-v1.cjs",
    PASS_FAIL: failCount === 0 && calendarCreateLeak === 0 && writeLeak === 0 ? "PASS" : "FAIL",
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2), "utf8");

  console.log("=== SILVER_SELF_CORRECTION_TASK_SURFACE_HARNESS_ALIGNMENT_V1 ===");
  console.log("main_commit=" + mainCommit);
  console.log("cluster=" + CLUSTER);
  console.log("cases_total=" + rep.cases_total);
  console.log("pass_count=" + rep.pass_count);
  console.log("fail_count=" + rep.fail_count);
  console.log("harness_problem_count=" + rep.harness_problem_count);
  console.log("gold_label_problem_count=" + rep.gold_label_problem_count);
  console.log("true_engine_bug_count=" + rep.true_engine_bug_count);
  console.log("safe_clarification_count=" + rep.safe_clarification_count);
  console.log("expected_unknown_count=" + rep.expected_unknown_count);
  console.log("calendar_create_leak_count=" + rep.calendar_create_leak_count);
  console.log("write_leak_count=" + rep.write_leak_count);
  console.log("fix_type=" + rep.fix_type);
  console.log("replay_guard=" + rep.replay_guard);
  console.log("PASS_FAIL=" + rep.PASS_FAIL);
  console.log("report=" + REPORT_JSON);
  console.log("=== END_SILVER_SELF_CORRECTION_TASK_SURFACE_HARNESS_ALIGNMENT_V1 ===");

  process.exit(rep.PASS_FAIL === "PASS" ? 0 : 1);
}

if (require.main === module) main();
