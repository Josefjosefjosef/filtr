#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-public-readiness-chaos-100k-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-mobile-voice-fragment-task-create-diagnostic-v1-report.json");
const SAMPLE = parseInt(process.env.SILVER_MOBILE_VOICE_FRAGMENT_DIAG_SAMPLE || "8000", 10);

function classifyFail(c, ev, turn) {
  const intent = String((turn && turn.normalizedIntent) || ev.intent || "");
  if (ev.bucket === "HARNESS_OR_GOLD") return "harness_or_gold";
  if (ev.bucket === "AMBIGUOUS_INPUT") return "ambiguous_input";
  if (ev.bucket === "SAFE_CLARIFICATION_OK") return "safe_clarification_ok";
  if (ev.bucket === "TEMPLATE_DNA_PROBLEM") return "template_dna_problem";
  if (c.safetyLabel === "no_write" && intent.indexOf("create") >= 0) return "safety_leak";
  if (intent.indexOf("note") >= 0 && c.expectModule === "tasks") return "note_steal";
  if (intent.indexOf("calendar") >= 0 && c.expectModule === "tasks") return "calendar_steal";
  if (intent === "clarification" || intent === "unknown") return "clarification";
  if (intent.indexOf("read") >= 0 && c.expectBehavior === "create") return "read_instead_of_create";
  if (intent.indexOf("create") >= 0 && c.expectBehavior === "read") return "wrong_create";
  return "unknown";
}

function main() {
  const eng = shared.loadEngine();
  const ctx = shared.defaultCtx();
  const cases = shared.buildLaneCorpus("mobile_voice", SAMPLE);
  const counters = {
    dangerous_write_count: 0,
    false_write_count: 0,
    query_created_write_count: 0,
    write_when_negated_count: 0,
    read_created_write_count: 0,
    help_created_write_count: 0,
    negated_created_write_count: 0,
    module_steal_count: 0,
    calendar_steal_count: 0,
    task_steal_count: 0,
    note_steal_count: 0,
    save_query_contamination_count: 0,
    help_save_contamination_count: 0,
    stale_context_reuse_count: 0,
    stale_entity_reuse_count: 0,
    stale_temporal_reuse_count: 0,
    fragment_reuse_fail_count: 0
  };

  let mvPass = 0;
  let mvFail = 0;
  let fragTotal = 0;
  let fragPass = 0;
  let fragFail = 0;
  let noteSteal = 0;
  let calendarSteal = 0;
  let unknownCount = 0;
  let clarificationCount = 0;
  let wrongCreate = 0;
  let readInstead = 0;
  let safetyLeak = 0;
  let trueEngine = 0;
  let harnessGold = 0;
  let ambiguous = 0;
  let safeClar = 0;
  let templateDna = 0;
  const failPatterns = {};
  const samples = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const ev = shared.evaluatePublicCase(eng, c, ctx, counters);
    const isFrag =
      c.family === "fragment_task_create" ||
      (c.expectBehavior === "create" && c.expectModule === "tasks" && /\bpripom\w*\s+mi\b/.test(shared.foldCs(c.input)));

    if (ev.pass) mvPass++;
    else mvFail++;

    if (isFrag) {
      fragTotal++;
      if (ev.pass) fragPass++;
      else fragFail++;
    }

    if (!ev.pass) {
      const kind = classifyFail(c, ev, { normalizedIntent: ev.intent });
      if (kind === "note_steal") noteSteal++;
      else if (kind === "calendar_steal") calendarSteal++;
      else if (kind === "clarification") clarificationCount++;
      else if (kind === "wrong_create") wrongCreate++;
      else if (kind === "read_instead_of_create") readInstead++;
      else if (kind === "safety_leak") safetyLeak++;
      else unknownCount++;

      if (ev.bucket === "TRUE_ENGINE_FAIL") trueEngine++;
      if (ev.bucket === "HARNESS_OR_GOLD") harnessGold++;
      if (ev.bucket === "AMBIGUOUS_INPUT") ambiguous++;
      if (ev.bucket === "SAFE_CLARIFICATION_OK") safeClar++;
      if (ev.bucket === "TEMPLATE_DNA_PROBLEM") templateDna++;

      const pat = kind + "|" + String(ev.intent || "");
      failPatterns[pat] = (failPatterns[pat] || 0) + 1;
      if (samples.length < 12) {
        samples.push({ input: c.input, intent: ev.intent, kind: kind });
      }
    }
  }

  const total = cases.length;
  const mvAcc = total ? ((mvPass / total) * 100).toFixed(2) : "0.00";
  const topFail = Object.keys(failPatterns)
    .sort(function (a, b) {
      return failPatterns[b] - failPatterns[a];
    })
    .slice(0, 8)
    .map(function (k) {
      return k + "=" + failPatterns[k];
    })
    .join(";");

  let recommended = "none";
  let safeToFix = "NO";
  let stopReason = "";
  if (trueEngine > 0 && harnessGold === 0 && ambiguous < trueEngine) {
    recommended = "narrow_engine_mobile_voice_fragment_task_create";
    safeToFix = "YES";
  } else if (harnessGold > trueEngine) {
    recommended = "harness_gold_alignment";
    safeToFix = "YES";
  } else if (ambiguous >= trueEngine && ambiguous > 0) {
    recommended = "harness_gold_safe_clarification_policy";
    safeToFix = "YES";
  } else if (safetyLeak > 0) {
    recommended = "STOP_safety_leak";
    safeToFix = "NO";
    stopReason = "safety_leak_detected";
  } else {
    recommended = "PASS_no_action";
    safeToFix = "YES";
  }

  const report = {
    total_mobile_voice_cases: total,
    mobile_voice_pass: mvPass,
    mobile_voice_fail: mvFail,
    mobile_voice_accuracy: mvAcc,
    fragment_task_create_total: fragTotal,
    fragment_task_create_pass: fragPass,
    fragment_task_create_fail: fragFail,
    note_steal_count: noteSteal,
    calendar_steal_count: calendarSteal,
    unknown_count: unknownCount,
    clarification_count: clarificationCount,
    wrong_create_count: wrongCreate,
    read_instead_of_create_count: readInstead,
    safety_leak_count: safetyLeak,
    true_engine_fail_count: trueEngine,
    harness_or_gold_count: harnessGold,
    ambiguous_input_count: ambiguous,
    safe_clarification_ok_count: safeClar,
    template_dna_problem_count: templateDna,
    top_fail_patterns: topFail,
    sample_failures: samples,
    recommended_fix_scope: recommended,
    safe_to_fix: safeToFix,
    stop_reason: stopReason
  };

  require("fs").writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_MOBILE_VOICE_FRAGMENT_TASK_CREATE_DIAGNOSTIC_V1 ===");
  console.log("total_mobile_voice_cases=" + report.total_mobile_voice_cases);
  console.log("mobile_voice_pass=" + report.mobile_voice_pass);
  console.log("mobile_voice_fail=" + report.mobile_voice_fail);
  console.log("mobile_voice_accuracy=" + report.mobile_voice_accuracy);
  console.log("fragment_task_create_total=" + report.fragment_task_create_total);
  console.log("fragment_task_create_pass=" + report.fragment_task_create_pass);
  console.log("fragment_task_create_fail=" + report.fragment_task_create_fail);
  console.log("note_steal_count=" + report.note_steal_count);
  console.log("calendar_steal_count=" + report.calendar_steal_count);
  console.log("unknown_count=" + report.unknown_count);
  console.log("clarification_count=" + report.clarification_count);
  console.log("wrong_create_count=" + report.wrong_create_count);
  console.log("read_instead_of_create_count=" + report.read_instead_of_create_count);
  console.log("safety_leak_count=" + report.safety_leak_count);
  console.log("true_engine_fail_count=" + report.true_engine_fail_count);
  console.log("harness_or_gold_count=" + report.harness_or_gold_count);
  console.log("ambiguous_input_count=" + report.ambiguous_input_count);
  console.log("safe_clarification_ok_count=" + report.safe_clarification_ok_count);
  console.log("template_dna_problem_count=" + report.template_dna_problem_count);
  console.log("top_fail_patterns=" + report.top_fail_patterns);
  console.log("sample_failures=" + JSON.stringify(report.sample_failures));
  console.log("recommended_fix_scope=" + report.recommended_fix_scope);
  console.log("safe_to_fix=" + report.safe_to_fix);
  console.log("stop_reason=" + report.stop_reason);
  console.log("=== END_SILVER_MOBILE_VOICE_FRAGMENT_TASK_CREATE_DIAGNOSTIC_V1 ===");
  process.exit(safetyLeak > 0 ? 1 : 0);
}

if (require.main === module) main();
