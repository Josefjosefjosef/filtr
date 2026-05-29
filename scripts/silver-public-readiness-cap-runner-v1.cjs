#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const prShared = require("./silver-public-readiness-chaos-100k-v1-shared.cjs");

const REPO = path.resolve(__dirname, "..");
const REPORT = path.join(__dirname, "silver-public-readiness-cap-runner-v1-report.json");
const CHAOS_SAMPLE = parseInt(process.env.SILVER_CAP_CHAOS_SAMPLE || "0", 10);

function runGate(cmd, label) {
  try {
    const out = execSync(cmd, { cwd: REPO, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    const pass = /PASS_FAIL=PASS/.test(out) || /SMOKE PASS/.test(out) || /passAll":\s*true/.test(out);
    const m = out.match(/pass=(\d+)\/(\d+)/);
    return { label: label, pass: pass, detail: m ? m[1] + "/" + m[2] : "PASS", raw: out.slice(0, 400) };
  } catch (e) {
    const out = String((e && e.stdout) || "") + String((e && e.stderr) || "");
    const m = out.match(/pass=(\d+)\/(\d+)/);
    return { label: label, pass: false, detail: m ? m[1] + "/" + m[2] : "FAIL", raw: out.slice(0, 400) };
  }
}

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function runChaosLane(lane, count) {
  const cases = prShared.buildLaneCorpus(lane, count);
  return prShared.runPublicReadinessAudit(cases, null);
}

function main() {
  const mainCommitHash = mainCommit();
  const coreGates = {
    smoke: runGate("npm run smoke", "smoke"),
    task_write_20k: runGate("node scripts/silver-task-write-20k-regression-guard.cjs", "task_write_20k"),
    task_query_20k: runGate("node scripts/silver-task-query-20k-regression-guard.cjs", "task_query_20k"),
    calendar_write_20k: runGate("node scripts/silver-calendar-write-20k-regression-guard.cjs", "calendar_write_20k"),
    calendar_query_20k: runGate("node scripts/silver-calendar-query-20k-regression-guard.cjs", "calendar_query_20k"),
    note_query_20k: runGate("node scripts/silver-note-query-20k-regression-guard.cjs", "note_query_20k"),
    search_read_v2: runGate("node scripts/silver-search-read-hardening-v2-guard.cjs", "search_read_v2"),
    firewall_v1: runGate("node scripts/silver-read-create-firewall-v1.cjs", "firewall_v1"),
    long_session: runGate("node scripts/silver-long-session-firewall-v1.cjs", "long_session"),
    timestamp: runGate("node scripts/silver-note-query-timestamp-display-guard-v1.cjs", "timestamp"),
    task_write_hardening: runGate("node scripts/silver-task-write-hardening-v1.cjs", "task_write_hardening"),
    conversational_ownership: runGate("node scripts/silver-conversational-ownership-guard-v1.cjs", "conversational_ownership"),
    mobile_voice: runGate("node scripts/silver-mobile-voice-chaos-guard-v1.cjs", "mobile_voice"),
    p0_real_user_basics: runGate("node scripts/silver-p0-real-user-basics-guard-v1.cjs", "p0_real_user_basics"),
    real_user_search_read: runGate("node scripts/silver-real-user-search-read-screenshot-v1.cjs", "real_user_search_read"),
    notes_relevance: runGate("node scripts/silver-notes-relevance-filtering-guard-v1.cjs", "notes_relevance"),
    tasks_search_read: runGate("node scripts/silver-task-search-read-firewall-guard-v1.cjs", "tasks_search_read"),
    calendar_metamorphic: runGate("node scripts/silver-calendar-query-metamorphic-guard-v1.cjs", "calendar_metamorphic"),
    calendar_no_diacritics: runGate("node scripts/silver-calendar-no-diacritics-query-guard-v1.cjs", "calendar_no_diacritics"),
    structured_extraction: runGate("node scripts/silver-structured-notes-extraction-guard-v1.cjs", "structured_extraction"),
    prod_proof: runGate("node scripts/silver-prod-proof.mjs", "prod_proof")
  };

  const chaosCounts = CHAOS_SAMPLE > 0
    ? { mobile_voice: CHAOS_SAMPLE, retrieval_nuance: CHAOS_SAMPLE, continuation_orchestration: CHAOS_SAMPLE, ux_edge_cases: CHAOS_SAMPLE }
    : { mobile_voice: 2000, retrieval_nuance: 2000, continuation_orchestration: 1500, ux_edge_cases: 1000 };

  const chaos = {};
  let totalChaos = 0;
  let chaosPass = 0;
  const lanes = Object.keys(chaosCounts);
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    const rep = runChaosLane(lane, chaosCounts[lane]);
    chaos[lane] = rep;
    totalChaos += rep.total_cases;
    chaosPass += Math.round((parseFloat(rep.overall_accuracy) / 100) * rep.total_cases);
  }

  const publicCases = CHAOS_SAMPLE > 0 ? prShared.buildFullCorpus(CHAOS_SAMPLE * 17) : prShared.buildFullCorpus();
  const publicRep = prShared.runPublicReadinessAudit(publicCases, path.join(__dirname, "silver-public-readiness-chaos-100k-v1-report.json"));

  const coreOk = Object.keys(coreGates).every(function (k) {
    return coreGates[k].pass;
  });
  const safetyOk =
    (publicRep.counters.dangerous_write_count || 0) === 0 &&
    (publicRep.counters.query_created_write_count || 0) === 0 &&
    (publicRep.counters.write_when_negated_count || 0) === 0;

  const publicScore = parseFloat(publicRep.overall_accuracy);
  const p0LaneOk = publicRep.p0_real_user_basics_lane_pass !== false;
  const report = {
    main_commit: mainCommitHash,
    pr_pending: "none",
    merged_prs: ["4693"],
    post_merge_proof: coreOk ? "PASS" : "FAIL",
    total_cases_run: publicRep.total_cases + totalChaos,
    lanes_run: lanes.length + Object.keys(prShared.LANE_TARGETS).length,
    overall_accuracy: publicRep.overall_accuracy,
    public_ready_score: publicScore,
    public_ready_candidate: coreOk && safetyOk && publicScore >= 99 && p0LaneOk ? "YES" : "NO",
    p0_real_user_basics_lane_pass: p0LaneOk ? "YES" : "NO",
    safety: publicRep.counters,
    core_gates: {},
    chaos_lanes: {},
    top_fail_family: (publicRep.top_fail_families || [])[0] || "none",
    true_engine_fail_count: publicRep.classification.true_engine_fail_count,
    harness_or_gold_count: publicRep.classification.harness_or_gold_count,
    ambiguous_count: publicRep.classification.ambiguous_input_count,
    safe_clarification_count: publicRep.classification.safe_clarification_ok_count,
    template_dna_problem_count: publicRep.classification.template_dna_problem_count,
    next_action: (publicRep.top_fail_families || [])[0] || "continue_cap",
    safe_to_continue: coreOk && safetyOk ? "YES" : "NO",
    stop_reason: coreOk && safetyOk ? "" : "core_or_safety_fail"
  };

  for (const k of Object.keys(coreGates)) {
    report.core_gates[k] = coreGates[k].detail;
  }
  for (const k of Object.keys(chaos)) {
    report.chaos_lanes[k] = chaos[k].overall_accuracy + "%";
  }

  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_PUBLIC_READINESS_CAP_RUNNER_V1 ===");
  console.log("main_commit=" + report.main_commit);
  console.log("pr_pending=" + report.pr_pending);
  console.log("merged_prs=" + report.merged_prs.join(","));
  console.log("post_merge_proof=" + report.post_merge_proof);
  console.log("total_cases_run=" + report.total_cases_run);
  console.log("lanes_run=" + report.lanes_run);
  console.log("overall_accuracy=" + report.overall_accuracy);
  console.log("public_ready_score=" + report.public_ready_score);
  console.log("public_ready_candidate=" + report.public_ready_candidate);
  console.log("dangerous_write_count=" + (report.safety.dangerous_write_count || 0));
  console.log("false_write_count=" + (report.safety.false_write_count || 0));
  console.log("query_created_write_count=" + (report.safety.query_created_write_count || 0));
  console.log("write_when_negated_count=" + (report.safety.write_when_negated_count || 0));
  console.log("task_write_20k=" + report.core_gates.task_write_20k);
  console.log("task_query_20k=" + report.core_gates.task_query_20k);
  console.log("calendar_write_20k=" + report.core_gates.calendar_write_20k);
  console.log("calendar_query_20k=" + report.core_gates.calendar_query_20k);
  console.log("note_query_20k=" + report.core_gates.note_query_20k);
  console.log("search_read_v2=" + report.core_gates.search_read_v2);
  console.log("firewall_v1=" + report.core_gates.firewall_v1);
  console.log("long_session=" + report.core_gates.long_session);
  console.log("timestamp=" + report.core_gates.timestamp);
  console.log("conversational_ownership=" + report.core_gates.conversational_ownership);
  console.log("mobile_voice=" + report.core_gates.mobile_voice);
  console.log("p0_real_user_basics=" + report.core_gates.p0_real_user_basics);
  console.log("prod_proof=" + report.core_gates.prod_proof);
  console.log("p0_real_user_basics_lane_pass=" + report.p0_real_user_basics_lane_pass);
  console.log("top_fail_family=" + report.top_fail_family);
  console.log("true_engine_fail_count=" + report.true_engine_fail_count);
  console.log("next_action=" + report.next_action);
  console.log("safe_to_continue=" + report.safe_to_continue);
  console.log("stop_reason=" + report.stop_reason);
  console.log("=== END_SILVER_PUBLIC_READINESS_CAP_RUNNER_V1 ===");

  process.exit(coreOk && safetyOk && p0LaneOk ? 0 : 1);
}

if (require.main === module) main();
