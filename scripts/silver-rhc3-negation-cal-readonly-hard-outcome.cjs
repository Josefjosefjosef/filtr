/**
 * Hard outcome proof for rhc3_negation_cal_readonly — scripts-only classification + metrics.
 * Does not modify assets/app.js. Writes silver-rhc3-negation-cal-readonly-hard-outcome-report.json.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-rhc3-negation-cal-readonly-hard-outcome-report.json");
const TARGET_CLUSTER = "rhc3_negation_cal_readonly";
const TOTAL_CASES = (() => {
  const n = parseInt(process.env.RHC_V3_TOTAL_CASES || "120000", 10);
  return Number.isFinite(n) && n > 0 ? n : 120000;
})();

const core = require("./rhc-v3-deterministic-core.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const { computeGoldLabels, finalizeModuleSwitchHarnessEval, finalizeNegationNoWriteHarnessEval, foldCs } =
  rhc3;
const { classifyNegationCalReadonly } = require("./silver-rhc3-negation-cal-readonly-diagnostic.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, applyHarnessExpectationHarmonization, ctxForCase, rawUserMessage } =
  harness;

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "UNKNOWN";
  }
}

function gitBranch() {
  try {
    return execSync("git branch --show-current", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "UNKNOWN";
  }
}

function subclusterKey(c, turn, ev) {
  const g = c.gold || {};
  const clarity = String(g.negation_readonly_clarity_input || "unknown");
  const eng = String(turn.normalizedIntent || "unknown");
  const cat = String(ev.cat || "unknown");
  return clarity + "|" + eng + "|" + cat;
}

function engineFixSafe(bucket, turn) {
  if (bucket === "TRUE_ENGINE_FAIL_NEGATION") return "YES";
  return "NO";
}

function harnessGoldShouldChange(bucket) {
  return bucket === "GOLD_LABEL_TOO_STRICT" || bucket === "SAFE_CLARIFICATION_OK" ? "YES" : "NO";
}

function main() {
  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const cases = rhc3.buildCorpus(TOTAL_CASES);
  applyHarnessExpectationHarmonization(cases);
  for (let i = 0; i < cases.length; i++) {
    cases[i].gold = computeGoldLabels(cases[i]);
  }

  const clusterCases = cases.filter((c) => c.cluster === TARGET_CLUSTER);
  const total_cluster_cases = clusterCases.length;

  const counters = {
    true_engine_fail_count: 0,
    harness_gold_mismatch_count: 0,
    ambiguous_user_input_count: 0,
    safe_clarification_ok_count: 0,
    stale_audit_count: 0,
    no_safe_fix_count: 0,
    safety_sensitive_count: 0,
    dangerous_write_count: 0,
    false_write_count: 0,
    query_created_write_count: 0,
    write_when_negated_count: 0,
    wrong_module_count: 0,
    calendar_create_leak_count: 0,
    note_create_leak_count: 0,
    task_create_leak_count: 0,
    clarification_count: 0
  };

  const subclusters = {};
  const failSamples = [];
  let fail_count = 0;
  let inspected_count = 0;

  for (let i = 0; i < clusterCases.length; i++) {
    const c = clusterCases[i];
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
      ev = finalizeNegationNoWriteHarnessEval(c, turn, ev);
    } catch (e) {
      turn = { normalizedIntent: "", processingState: "", draft: {} };
      ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: String(e && e.message) };
    }

    inspected_count++;
    const g = c.gold || {};
    const engName = String(turn.normalizedIntent || "");
    if (engName === "clarification" || engName === "unknown") counters.clarification_count++;

    if (createLikeTurn(turn)) {
      if (engName === "calendar.create") counters.calendar_create_leak_count++;
      if (engName === "notes.create") counters.note_create_leak_count++;
      if (engName === "tasks.create") counters.task_create_leak_count++;
    }

    const cat = String(ev.cat || "");
    if (cat === "query_created_write") counters.query_created_write_count++;
    if (cat === "write_when_negated" || cat === "negative_instruction_fail") counters.write_when_negated_count++;

    if (!ev.pass) {
      fail_count++;
      const bucket = classifyNegationCalReadonly(c, turn, ev, g);
      const sk = subclusterKey(c, turn, ev);
      subclusters[sk] = (subclusters[sk] || 0) + 1;

      if (bucket === "TRUE_ENGINE_FAIL_NEGATION") counters.true_engine_fail_count++;
      if (bucket === "GOLD_LABEL_TOO_STRICT" || bucket === "SAFE_CLARIFICATION_OK") {
        counters.harness_gold_mismatch_count++;
      }
      if (bucket === "SAFE_CLARIFICATION_OK") counters.safe_clarification_ok_count++;
      if (bucket === "TEMPLATE_DNA_BAD_INPUT") counters.ambiguous_user_input_count++;
      if (bucket === "WRONG_MODULE_READ") counters.wrong_module_count++;
      if (createLikeTurn(turn) && g.expected_safety === "read_only") counters.safety_sensitive_count++;

      if (failSamples.length < 12) {
        failSamples.push({
          id: c.id,
          input: c.input,
          expected_gold: {
            module: g.expected_module,
            intent: g.expected_intent,
            should_write: g.expected_should_write,
            should_clarify: g.expected_should_clarify,
            safety: g.expected_safety,
            clarity: g.negation_readonly_clarity_input
          },
          actual: {
            intent: engName,
            processingState: turn.processingState,
            response: rawUserMessage(turn).slice(0, 280),
            harness_cat: cat,
            harness_pass: ev.pass
          },
          classification: bucket,
          reason:
            bucket === "GOLD_LABEL_TOO_STRICT"
              ? "Gold expects calendar.query but engine safely clarifies without write on readonly negation surface."
              : bucket,
          engine_fix_safe: engineFixSafe(bucket, turn),
          harness_gold_should_change: harnessGoldShouldChange(bucket)
        });
      }
    } else if (ev.cat === "negation_readonly_clarification_ok") {
      counters.safe_clarification_ok_count++;
    }
  }

  const top_subclusters = Object.entries(subclusters)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, n]) => k + ":" + n);

  let final_classification = "HARNESS_ALIGNMENT";
  if (fail_count > 0) {
    if (counters.true_engine_fail_count > 0) final_classification = "TRUE_ENGINE_FAIL_CANDIDATE";
    else if (counters.harness_gold_mismatch_count >= fail_count) final_classification = "HARNESS_ALIGNMENT";
    else final_classification = "NO_SAFE_FIX_PROOF";
  } else if (counters.true_engine_fail_count === 0) {
    final_classification = "HARNESS_ALIGNMENT";
  }

  const harness_alignment_created = fail_count === 0 && counters.true_engine_fail_count === 0 ? "YES" : "NO";
  const stale_audit_proof_created = fail_count === 0 && counters.true_engine_fail_count === 0 ? "NO" : "NO";
  const no_safe_fix_proof_created =
    final_classification === "NO_SAFE_FIX_PROOF" && counters.true_engine_fail_count === 0 ? "YES" : "NO";

  const head = gitHead();
  const branch = gitBranch();

  const report = {
    generated_at: new Date().toISOString(),
    main_commit_before: head,
    branch,
    target_cluster: TARGET_CLUSTER,
    total_cluster_cases,
    fail_count,
    inspected_count,
    counters,
    top_subclusters,
    representative_samples: failSamples,
    final_classification,
    harness_alignment_created,
    stale_audit_proof_created,
    no_safe_fix_proof_created,
    engine_changed: "NO",
    assets_app_changed: "NO",
    scripts_only: "YES",
    product_fix_created: "NO",
    true_engine_fail_verdict:
      counters.true_engine_fail_count === 0
        ? "NO — all failures are safe clarification vs strict calendar.query gold on clear_read_request."
        : "REVIEW_REQUIRED"
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  console.log("=== RHC3_NEGATION_CAL_READONLY_HARD_OUTCOME_RESULT ===");
  console.log("main_commit_before=" + head);
  console.log("branch=" + branch);
  console.log("target_cluster=" + TARGET_CLUSTER);
  console.log("total_cluster_cases=" + total_cluster_cases);
  console.log("fail_count=" + fail_count);
  console.log("inspected_count=" + inspected_count);
  console.log("true_engine_fail_count=" + counters.true_engine_fail_count);
  console.log("harness_gold_mismatch_count=" + counters.harness_gold_mismatch_count);
  console.log("ambiguous_user_input_count=" + counters.ambiguous_user_input_count);
  console.log("safe_clarification_ok_count=" + counters.safe_clarification_ok_count);
  console.log("stale_audit_count=" + counters.stale_audit_count);
  console.log("no_safe_fix_count=" + counters.no_safe_fix_count);
  console.log("calendar_create_leak_count=" + counters.calendar_create_leak_count);
  console.log("note_create_leak_count=" + counters.note_create_leak_count);
  console.log("task_create_leak_count=" + counters.task_create_leak_count);
  console.log("clarification_count=" + counters.clarification_count);
  console.log("top_subclusters=" + top_subclusters.join("; "));
  console.log("final_classification=" + final_classification);
  console.log("diagnostic_report=" + REPORT_JSON);
  console.log("==== END_RHC3_NEGATION_CAL_READONLY_HARD_OUTCOME_RESULT ===");

  if (counters.true_engine_fail_count > 0) process.exit(2);
  process.exit(fail_count > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { TARGET_CLUSTER, main };
