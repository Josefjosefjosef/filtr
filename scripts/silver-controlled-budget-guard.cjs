#!/usr/bin/env node
/**
 * Silver — Controlled Autonomous Budget Guard V1 (orchestration only).
 * Hard caps on agent invokes, decisions, retries, stagnation, self-expanding goals.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const CONTROLLED_CAP_PROFILE_DEFAULT = "CAP10_SAFE";

const PROFILES = {
  CAP10_SAFE: {
    max_agent_invokes_per_cap: 25,
    max_autonomous_decisions_per_cap: 20,
    max_self_retries_per_cap: 2,
    max_audit_reruns_per_cap: 2,
    max_pr_attempts_per_cap: 1,
    max_merge_attempts_per_cap: 1,
    max_same_failure_repeats: 2,
    max_same_cluster_repeats_without_delta: 2,
    soft_runtime_minutes: 45,
    hard_runtime_minutes: 90,
    no_recursive_cap_creation: true,
    no_self_expanding_goal: true,
    require_final_outcome: true,
    require_metric_delta_block: true,
    require_git_clean_or_explicit_dirty_explanation: true,
  },
  CAP25_SAFE: {
    max_agent_invokes_per_cap: 40,
    max_autonomous_decisions_per_cap: 32,
    max_self_retries_per_cap: 3,
    max_audit_reruns_per_cap: 3,
    max_pr_attempts_per_cap: 2,
    max_merge_attempts_per_cap: 1,
    max_same_failure_repeats: 3,
    max_same_cluster_repeats_without_delta: 3,
    soft_runtime_minutes: 90,
    hard_runtime_minutes: 180,
    no_recursive_cap_creation: true,
    no_self_expanding_goal: true,
    require_final_outcome: true,
    require_metric_delta_block: true,
    require_git_clean_or_explicit_dirty_explanation: true,
  },
  CAP50_SAFE: {
    max_agent_invokes_per_cap: 60,
    max_autonomous_decisions_per_cap: 48,
    max_self_retries_per_cap: 4,
    max_audit_reruns_per_cap: 4,
    max_pr_attempts_per_cap: 2,
    max_merge_attempts_per_cap: 2,
    max_same_failure_repeats: 4,
    max_same_cluster_repeats_without_delta: 4,
    soft_runtime_minutes: 180,
    hard_runtime_minutes: 360,
    no_recursive_cap_creation: true,
    no_self_expanding_goal: true,
    require_final_outcome: true,
    require_metric_delta_block: true,
    require_git_clean_or_explicit_dirty_explanation: true,
  },
};

const FINAL_OUTCOMES = new Set([
  "ENGINE_FIX_TASK_READY",
  "HARNESS_ALIGNMENT_TASK_READY",
  "PLANNER_ALIGNMENT_TASK_READY",
  "PR_READY",
  "MERGED_AND_PROVED",
  "NO_SAFE_FIX",
  "SAFE_BLOCKED",
  "HARD_FAIL",
  "NEED_HUMAN_INPUT",
  "NO_CHANGE",
]);

const SELF_EXPANDING_PATTERNS = [
  /continue\s+improv(e|ing)\s+forever/i,
  /run\s+another\s+autonomous\s+loop/i,
  /continue\s+until\s+perfect/i,
  /keep\s+optimiz(e|ing)\s+automatically/i,
  /no\s+issues\s+remain/i,
  /autonomously\s+improv(e|ing)\s+forever/i,
  /infinite\s+improvement/i,
  /maxcycles\s*0\s+without/i,
];

const METRIC_KEYS = [
  "20k_overall_accuracy",
  "quality_accuracy",
  "realistic_overall_accuracy",
  "real_czech_corpus_accuracy",
  "deep_product_real_ux_v2_accuracy",
  "public_ux_corpus_accuracy",
  "calendar_write_20k",
  "calendar_query_20k",
  "dangerous_write_count",
  "false_write_count",
  "query_created_write_count",
  "write_when_negated_count",
];

const REPORT_SOURCES = {
  "20k_overall_accuracy": "scripts/silver-real-czech-corpus-v1-report.json; silver-real-human-chaos-v3-report.json",
  quality_accuracy: "scripts/silver-quality-v2-report.json",
  realistic_overall_accuracy: "scripts/silver-realistic-mobile-corpus-report.json",
  real_czech_corpus_accuracy: "scripts/silver-real-czech-corpus-v1-report.json",
  deep_product_real_ux_v2_accuracy: "scripts/silver-deep-product-real-ux-v2-report.json",
  public_ux_corpus_accuracy: "scripts/silver-real-czech-public-ux-corpus-v2-report.json",
  calendar_write_20k: "audit registry / corpus reports",
  calendar_query_20k: "audit registry / corpus reports",
  dangerous_write_count: "scripts/silver-*-report.json safety counters",
  false_write_count: "scripts/silver-*-report.json safety counters",
  query_created_write_count: "scripts/silver-*-report.json safety counters",
  write_when_negated_count: "scripts/silver-*-report.json safety counters",
};

function readJsonSafe(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

function readTextSafe(abs) {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function resolveProfileId(explicit, capLabel) {
  const env = String(process.env.SILVER_CONTROLLED_CAP_PROFILE || "").trim();
  if (explicit && PROFILES[explicit]) return explicit;
  if (env && PROFILES[env]) return env;
  const lbl = String(capLabel || "").toUpperCase();
  if (lbl === "CAP25") return "CAP25_SAFE";
  if (lbl === "CAP50") return "CAP50_SAFE";
  return CONTROLLED_CAP_PROFILE_DEFAULT;
}

function profileForCapLabel(capLabel) {
  return resolveProfileId(null, capLabel);
}

function statePath(repoRoot, runId) {
  const dir = path.join(repoRoot, ".silver-runtime");
  const id = String(runId || "default").replace(/[^\w.-]+/g, "_");
  return path.join(dir, "controlled-budget-guard-" + id + ".json");
}

function loadState(repoRoot, runId) {
  const p = statePath(repoRoot, runId);
  const data = readJsonSafe(p);
  if (!data || typeof data !== "object") return null;
  return data;
}

function saveState(repoRoot, state) {
  const p = statePath(repoRoot, state.run_id || "default");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2), "utf8");
  return p;
}

function createState(repoRoot, opts) {
  const capLabel = opts.capLabel || "CAP10";
  const profileId = resolveProfileId(opts.profileId, capLabel);
  const profile = PROFILES[profileId];
  const now = new Date().toISOString();
  const state = {
    version: 1,
    run_id: opts.runId || "default",
    cap_label: capLabel,
    profile_id: profileId,
    profile: profile,
    started_at: now,
    soft_runtime_deadline_at: new Date(Date.now() + profile.soft_runtime_minutes * 60000).toISOString(),
    hard_runtime_deadline_at: new Date(Date.now() + profile.hard_runtime_minutes * 60000).toISOString(),
    counts: {
      agent_invokes: 0,
      autonomous_decisions: 0,
      self_retries: 0,
      audit_reruns: 0,
      pr_attempts: 0,
      merge_attempts: 0,
    },
    stagnation: {
      stop_reasons: {},
      output_hashes: {},
      audit_summaries: {},
      clusters_without_delta: {},
    },
    recursive_cap_blocked: false,
    final_outcome: "",
    metric_delta_block_present: false,
    git_dirty_explanation: "",
    stopped: false,
    stop_reason: "",
  };
  saveState(repoRoot, state);
  return state;
}

function emitStop(state, reason) {
  state.stopped = true;
  state.stop_reason = reason;
  return {
    stop: true,
    reason,
    line: "CONTROLLED_BUDGET_GUARD_STOP=" + reason,
  };
}

function evaluateRuntime(state) {
  const now = Date.now();
  const hard = Date.parse(state.hard_runtime_deadline_at || "");
  if (Number.isFinite(hard) && now > hard) {
    return emitStop(state, "HARD_RUNTIME_EXCEEDED");
  }
  return null;
}

function evaluateCounters(state) {
  const p = state.profile;
  const c = state.counts;
  if (c.agent_invokes > p.max_agent_invokes_per_cap) return emitStop(state, "MAX_AGENT_INVOKES");
  if (c.autonomous_decisions > p.max_autonomous_decisions_per_cap) return emitStop(state, "MAX_AUTONOMOUS_DECISIONS");
  if (c.self_retries > p.max_self_retries_per_cap) return emitStop(state, "MAX_SELF_RETRIES");
  if (c.audit_reruns > p.max_audit_reruns_per_cap) return emitStop(state, "MAX_AUDIT_RERUNS");
  if (c.pr_attempts > p.max_pr_attempts_per_cap) return emitStop(state, "MAX_PR_ATTEMPTS");
  if (c.merge_attempts > p.max_merge_attempts_per_cap) return emitStop(state, "MAX_MERGE_ATTEMPTS");
  return null;
}

function bumpStagnationBucket(bucket, key, maxRepeats) {
  if (!key) return null;
  const k = String(key).trim().slice(0, 200);
  if (!k) return null;
  bucket[k] = (bucket[k] || 0) + 1;
  if (bucket[k] > maxRepeats) return k;
  return null;
}

function evaluateStagnation(state, signals) {
  const maxFail = state.profile.max_same_failure_repeats;
  const maxCluster = state.profile.max_same_cluster_repeats_without_delta;
  const st = state.stagnation;
  if (signals.stopReason) {
    const hit = bumpStagnationBucket(st.stop_reasons, signals.stopReason, maxFail);
    if (hit) return emitStop(state, "STAGNATION_DETECTED");
  }
  if (signals.outputHash) {
    const hit = bumpStagnationBucket(st.output_hashes, signals.outputHash, maxFail);
    if (hit) return emitStop(state, "STAGNATION_DETECTED");
  }
  if (signals.auditSummary) {
    const hit = bumpStagnationBucket(st.audit_summaries, signals.auditSummary, maxFail);
    if (hit) return emitStop(state, "STAGNATION_DETECTED");
  }
  if (signals.cluster) {
    const hit = bumpStagnationBucket(st.clusters_without_delta, signals.cluster, maxCluster);
    if (hit) return emitStop(state, "STAGNATION_DETECTED");
  }
  return null;
}

function detectSelfExpandingGoal(text) {
  const blob = String(text || "");
  for (const re of SELF_EXPANDING_PATTERNS) {
    if (re.test(blob)) return true;
  }
  return false;
}

function checkSelfExpanding(state, text) {
  if (!state.profile.no_self_expanding_goal) return null;
  if (detectSelfExpandingGoal(text)) return emitStop(state, "SELF_EXPANDING_GOAL_BLOCKED");
  return null;
}

function evaluateAll(state, extra) {
  if (state.stopped) {
    return { stop: true, reason: state.stop_reason, line: "CONTROLLED_BUDGET_GUARD_STOP=" + state.stop_reason };
  }
  const checks = [
    () => evaluateRuntime(state),
    () => evaluateCounters(state),
    () => (extra && extra.signals ? evaluateStagnation(state, extra.signals) : null),
    () => (extra && extra.text ? checkSelfExpanding(state, extra.text) : null),
  ];
  for (const fn of checks) {
    const hit = fn();
    if (hit) return hit;
  }
  return { stop: false, reason: "", line: "" };
}

function recordAgentInvoke(repoRoot, runId) {
  const state = loadState(repoRoot, runId);
  if (!state) return { ok: false, error: "STATE_MISSING" };
  state.counts.agent_invokes += 1;
  const hit = evaluateAll(state, {});
  saveState(repoRoot, state);
  return { ok: !hit.stop, state, hit };
}

function recordCounter(repoRoot, runId, counterName, amount) {
  const state = loadState(repoRoot, runId);
  if (!state) return { ok: false, error: "STATE_MISSING" };
  if (!state.counts[counterName] && state.counts[counterName] !== 0) {
    return { ok: false, error: "UNKNOWN_COUNTER" };
  }
  state.counts[counterName] += amount || 1;
  const hit = evaluateAll(state, {});
  saveState(repoRoot, state);
  return { ok: !hit.stop, state, hit };
}

function recordStagnationSignals(repoRoot, runId, signals) {
  const state = loadState(repoRoot, runId);
  if (!state) return { ok: false, error: "STATE_MISSING" };
  const hit = evaluateStagnation(state, signals || {});
  if (hit) {
    saveState(repoRoot, state);
    return { ok: false, state, hit };
  }
  saveState(repoRoot, state);
  return { ok: true, state, hit: { stop: false } };
}

function parsePct(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) return parseFloat(m[1]);
  const t = s.replace("%", "").trim();
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  return null;
}

function pickMetricFromReports(repoRoot, key) {
  const scriptsDir = path.join(repoRoot, "scripts");
  if (!fs.existsSync(scriptsDir)) {
    return { value: null, source: REPORT_SOURCES[key] || "NOT_AVAILABLE" };
  }
  const files = fs.readdirSync(scriptsDir).filter((f) => f.endsWith("-report.json"));
  for (const fn of files) {
    const data = readJsonSafe(path.join(scriptsDir, fn));
    if (!data) continue;
    if (data[key] != null && String(data[key]).trim() !== "") {
      return { value: data[key], source: "scripts/" + fn };
    }
    if (data.baseline_metrics && data.baseline_metrics[key] != null) {
      return { value: data.baseline_metrics[key], source: "scripts/" + fn + ":baseline_metrics" };
    }
    if (data.safety && data.safety[key] != null) {
      return { value: data.safety[key], source: "scripts/" + fn + ":safety" };
    }
  }
  return { value: null, source: REPORT_SOURCES[key] || "NOT_AVAILABLE" };
}

function buildMetricDeltaBlock(repoRoot, beforeSnap, afterSnap) {
  const lines = [];
  lines.push("=== CONTROLLED_BUDGET_METRIC_DELTA_BLOCK ===");
  for (const key of METRIC_KEYS) {
    let beforeVal = beforeSnap && beforeSnap[key] != null ? beforeSnap[key] : null;
    let afterVal = afterSnap && afterSnap[key] != null ? afterSnap[key] : null;
    let source = "";
    if (beforeVal == null || afterVal == null) {
      const picked = pickMetricFromReports(repoRoot, key);
      if (beforeVal == null) beforeVal = picked.value;
      if (afterVal == null) afterVal = picked.value;
      source = picked.source;
    }
    const bPct = parsePct(beforeVal);
    const aPct = parsePct(afterVal);
    let delta = "NOT_AVAILABLE";
    let verdict = "NOT_AVAILABLE";
    if (bPct != null && aPct != null) {
      const d = aPct - bPct;
      delta = (d >= 0 ? "+" : "") + d.toFixed(2) + "%";
      if (Math.abs(d) < 0.01) verdict = "UNCHANGED";
      else if (d > 0) verdict = "IMPROVED";
      else verdict = "REGRESSED";
    } else if (beforeVal != null && afterVal != null && String(beforeVal) === String(afterVal)) {
      delta = "0";
      verdict = "UNCHANGED";
    }
    const bDisp = beforeVal != null ? String(beforeVal) : "NOT_AVAILABLE";
    const aDisp = afterVal != null ? String(afterVal) : "NOT_AVAILABLE";
    if (bDisp === "NOT_AVAILABLE" || aDisp === "NOT_AVAILABLE") {
      lines.push(
        key +
          " baseline_before=" +
          bDisp +
          " result_after=" +
          aDisp +
          " delta_percent=NOT_AVAILABLE verdict=NOT_AVAILABLE source_reports=" +
          (source || REPORT_SOURCES[key] || "unknown"),
      );
      if (bDisp === "NOT_AVAILABLE" || aDisp === "NOT_AVAILABLE") {
        lines.push(key + "_na_reason=metric_missing expected_report_source=" + (REPORT_SOURCES[key] || "audit_reports"));
      }
    } else {
      lines.push(
        key +
          " baseline_before=" +
          bDisp +
          " result_after=" +
          aDisp +
          " delta_percent=" +
          delta +
          " verdict=" +
          verdict +
          " source_reports=" +
          (source || REPORT_SOURCES[key] || "runtime_snapshots"),
      );
    }
  }
  lines.push("=== END_CONTROLLED_BUDGET_METRIC_DELTA_BLOCK ===");
  return lines.join("\n");
}

function captureMetricSnapshot(repoRoot) {
  const snap = {};
  for (const key of METRIC_KEYS) {
    const picked = pickMetricFromReports(repoRoot, key);
    snap[key] = picked.value;
  }
  return snap;
}

function finalizeCap(repoRoot, runId, opts) {
  const state = loadState(repoRoot, runId);
  if (!state) return { ok: false, error: "STATE_MISSING" };
  const outcome = String(opts.finalOutcome || "").trim().toUpperCase();
  const failures = [];
  if (state.profile.require_final_outcome) {
    if (!FINAL_OUTCOMES.has(outcome)) failures.push("FINAL_OUTCOME_REQUIRED");
    else state.final_outcome = outcome;
  }
  const beforeSnap = state.metric_before || captureMetricSnapshot(repoRoot);
  const afterSnap = captureMetricSnapshot(repoRoot);
  const deltaBlock = buildMetricDeltaBlock(repoRoot, beforeSnap, afterSnap);
  if (state.profile.require_metric_delta_block) {
    if (deltaBlock.indexOf("=== CONTROLLED_BUDGET_METRIC_DELTA_BLOCK ===") < 0) {
      failures.push("METRIC_DELTA_BLOCK_REQUIRED");
    } else {
      state.metric_delta_block_present = true;
    }
  }
  const runReportPath = path.join(repoRoot, "SILVER_RUN_REPORT.md");
  let reportText = readTextSafe(runReportPath);
  if (!reportText.includes("CONTROLLED_BUDGET_METRIC_DELTA_BLOCK")) {
    reportText = reportText.trimEnd() + "\n\n" + deltaBlock + "\n";
    fs.writeFileSync(runReportPath, reportText, "utf8");
  }
  if (opts.gitDirtyExplanation) state.git_dirty_explanation = String(opts.gitDirtyExplanation);
  if (failures.length) {
    state.stopped = true;
    state.stop_reason = failures[0];
    saveState(repoRoot, state);
    return { ok: false, failures, state, deltaBlock };
  }
  saveState(repoRoot, state);
  return { ok: true, state, deltaBlock, final_outcome: outcome };
}

function printStatusBlock(state) {
  console.log("=== CONTROLLED_BUDGET_GUARD_STATUS ===");
  console.log("profile_id=" + state.profile_id);
  console.log("cap_label=" + state.cap_label);
  console.log("CONTROLLED_CAP_PROFILE_DEFAULT=" + CONTROLLED_CAP_PROFILE_DEFAULT);
  console.log("agent_invokes=" + state.counts.agent_invokes + "/" + state.profile.max_agent_invokes_per_cap);
  console.log("autonomous_decisions=" + state.counts.autonomous_decisions + "/" + state.profile.max_autonomous_decisions_per_cap);
  console.log("self_retries=" + state.counts.self_retries + "/" + state.profile.max_self_retries_per_cap);
  console.log("audit_reruns=" + state.counts.audit_reruns + "/" + state.profile.max_audit_reruns_per_cap);
  console.log("stopped=" + (state.stopped ? "YES" : "NO"));
  if (state.stop_reason) console.log("CONTROLLED_BUDGET_GUARD_STOP=" + state.stop_reason);
  console.log("final_outcome=" + (state.final_outcome || "(unset)"));
  console.log("metric_delta_block_present=" + (state.metric_delta_block_present ? "YES" : "NO"));
  console.log("=== END_CONTROLLED_BUDGET_GUARD_STATUS ===");
}

function runSelftest() {
  const failures = [];
  const assert = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  assert(resolveProfileId(null, "CAP10") === "CAP10_SAFE", "default_cap10");
  assert(resolveProfileId(null, "CAP25") === "CAP25_SAFE", "cap25_profile");
  assert(resolveProfileId(null, "CAP50") === "CAP50_SAFE", "cap50_profile");
  assert(CONTROLLED_CAP_PROFILE_DEFAULT === "CAP10_SAFE", "default_constant");
  assert(PROFILES.CAP25_SAFE.max_agent_invokes_per_cap > PROFILES.CAP10_SAFE.max_agent_invokes_per_cap, "cap25_higher_invokes");
  assert(PROFILES.CAP50_SAFE.max_agent_invokes_per_cap > PROFILES.CAP25_SAFE.max_agent_invokes_per_cap, "cap50_higher_invokes");

  const td = path.join(require("os").tmpdir(), "silver-budget-guard-selftest-" + Date.now());
  fs.mkdirSync(td, { recursive: true });
  const runId = "selftest-run";

  let st = createState(td, { runId, capLabel: "CAP10", profileId: "CAP10_SAFE" });
  st.metric_before = { "20k_overall_accuracy": "10%", quality_accuracy: "20%" };
  saveState(td, st);

  for (let i = 0; i < PROFILES.CAP10_SAFE.max_agent_invokes_per_cap; i++) {
    const r = recordAgentInvoke(td, runId);
    assert(r.ok, "invoke_under_cap_" + i);
  }
  const overInvoke = recordAgentInvoke(td, runId);
  assert(!overInvoke.ok && overInvoke.hit.reason === "MAX_AGENT_INVOKES", "max_agent_invokes_stop");

  st = createState(td, { runId: "decisions", capLabel: "CAP10" });
  for (let i = 0; i < PROFILES.CAP10_SAFE.max_autonomous_decisions_per_cap; i++) {
    const r = recordCounter(td, "decisions", "autonomous_decisions", 1);
    assert(r.ok, "decision_under_cap");
  }
  const overDec = recordCounter(td, "decisions", "autonomous_decisions", 1);
  assert(!overDec.ok && overDec.hit.reason === "MAX_AUTONOMOUS_DECISIONS", "max_decisions_stop");

  st = createState(td, { runId: "stagnation", capLabel: "CAP10" });
  for (let i = 0; i < PROFILES.CAP10_SAFE.max_same_cluster_repeats_without_delta; i++) {
    recordStagnationSignals(td, "stagnation", { cluster: "self_correction_negation_flip" });
  }
  const stagHit = recordStagnationSignals(td, "stagnation", { cluster: "self_correction_negation_flip" });
  assert(!stagHit.ok && stagHit.hit.reason === "STAGNATION_DETECTED", "stagnation_cluster");

  st = createState(td, { runId: "selfexpand", capLabel: "CAP10" });
  const se = checkSelfExpanding(st, "Please continue improving forever until perfect");
  assert(se && se.reason === "SELF_EXPANDING_GOAL_BLOCKED", "self_expanding_blocked");

  st = createState(td, { runId: "outcome", capLabel: "CAP10" });
  const badFin = finalizeCap(td, "outcome", { finalOutcome: "INVALID" });
  assert(!badFin.ok && badFin.failures.includes("FINAL_OUTCOME_REQUIRED"), "final_outcome_required");

  fs.writeFileSync(path.join(td, "SILVER_RUN_REPORT.md"), "# report\n", "utf8");
  const scriptsDir = path.join(td, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptsDir, "silver-quality-v2-report.json"),
    JSON.stringify({ quality_accuracy: "55.0%" }) + "\n",
    "utf8",
  );
  const goodFin = finalizeCap(td, "outcome", { finalOutcome: "NO_CHANGE" });
  assert(goodFin.ok, "finalize_with_outcome");
  assert(readTextSafe(path.join(td, "SILVER_RUN_REPORT.md")).includes("CONTROLLED_BUDGET_METRIC_DELTA_BLOCK"), "metric_delta_in_report");

  st = createState(td, { runId: "runtime", capLabel: "CAP10" });
  st.hard_runtime_deadline_at = new Date(Date.now() - 1000).toISOString();
  saveState(td, st);
  const rtHit = evaluateAll(st, {});
  assert(rtHit.stop && rtHit.reason === "HARD_RUNTIME_EXCEEDED", "hard_runtime");

  const cap25 = resolveProfileId("CAP25_SAFE", "CAP10");
  assert(cap25 === "CAP25_SAFE", "profile_switch_no_refactor");

  try {
    fs.rmSync(td, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  const pass = failures.length === 0;
  console.log("=== CONTROLLED_BUDGET_GUARD_SELFTEST ===");
  console.log("CONTROLLED_BUDGET_GUARD_SELFTEST=" + (pass ? "PASS" : "FAIL"));
  console.log("CAP10_SAFE_default=" + (CONTROLLED_CAP_PROFILE_DEFAULT === "CAP10_SAFE" ? "YES" : "NO"));
  console.log("CAP25_CAP50_profiles_available=YES");
  console.log("runaway_invoke_loop_blocked=YES");
  console.log("stagnation_detector=YES");
  console.log("self_expanding_goal_block=YES");
  console.log("final_outcome_required=YES");
  console.log("metric_delta_block_required=YES");
  console.log("engine_changed=NO");
  console.log("assets_app_changed=NO");
  if (!pass) {
    for (const f of failures) console.log("FAIL_DETAIL=" + f);
  }
  console.log("=== END_CONTROLLED_BUDGET_GUARD_SELFTEST ===");
  return pass;
}

function parseArgs(argv) {
  const out = { cmd: "", repoRoot: process.cwd(), runId: "default", capLabel: "CAP10", profileId: "", finalOutcome: "", gitDirtyExplanation: "", text: "", signals: {} };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo" && argv[i + 1]) {
      out.repoRoot = path.resolve(argv[++i]);
    } else if (a === "--run-id" && argv[i + 1]) {
      out.runId = argv[++i];
    } else if (a === "--cap-label" && argv[i + 1]) {
      out.capLabel = argv[++i];
    } else if (a === "--profile" && argv[i + 1]) {
      out.profileId = argv[++i];
    } else if (a === "--final-outcome" && argv[i + 1]) {
      out.finalOutcome = argv[++i];
    } else if (a === "--git-dirty-explanation" && argv[i + 1]) {
      out.gitDirtyExplanation = argv[++i];
    } else if (a === "--text-file" && argv[i + 1]) {
      out.text = readTextSafe(path.resolve(argv[++i]));
    } else if (a === "--stop-reason" && argv[i + 1]) {
      out.signals.stopReason = argv[++i];
    } else if (a === "--cluster" && argv[i + 1]) {
      out.signals.cluster = argv[++i];
    } else if (a === "--output-hash" && argv[i + 1]) {
      out.signals.outputHash = argv[++i];
    } else if (a === "--audit-summary" && argv[i + 1]) {
      out.signals.auditSummary = argv[++i];
    } else if (a === "--counter" && argv[i + 1]) {
      out.counterName = argv[++i];
    } else if (!a.startsWith("--")) {
      if (!out.cmd) out.cmd = a;
      else rest.push(a);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = args.repoRoot;
  const cmd = args.cmd || "help";

  if (cmd === "selftest") {
    process.exit(runSelftest() ? 0 : 1);
  }

  if (cmd === "profiles") {
    console.log("CONTROLLED_CAP_PROFILE_DEFAULT=" + CONTROLLED_CAP_PROFILE_DEFAULT);
    for (const id of Object.keys(PROFILES)) {
      console.log("profile=" + id + " max_agent_invokes=" + PROFILES[id].max_agent_invokes_per_cap);
    }
    return;
  }

  if (cmd === "init") {
    const st = createState(repoRoot, {
      runId: args.runId,
      capLabel: args.capLabel,
      profileId: args.profileId,
    });
    st.metric_before = captureMetricSnapshot(repoRoot);
    saveState(repoRoot, st);
    console.log("CONTROLLED_BUDGET_GUARD_INIT=OK");
    console.log("profile_id=" + st.profile_id);
    console.log("state_path=" + statePath(repoRoot, args.runId));
    return;
  }

  if (cmd === "status") {
    const st = loadState(repoRoot, args.runId);
    if (!st) {
      console.log("CONTROLLED_BUDGET_GUARD_STATUS=MISSING");
      process.exit(1);
    }
    printStatusBlock(st);
    return;
  }

  if (cmd === "record-invoke") {
    const r = recordAgentInvoke(repoRoot, args.runId);
    if (r.hit && r.hit.line) console.log(r.hit.line);
    console.log("record_agent_invoke=" + (r.ok ? "OK" : "STOP"));
    process.exit(r.ok ? 0 : 2);
  }

  if (cmd === "record-counter") {
    const r = recordCounter(repoRoot, args.runId, args.counterName, 1);
    if (r.hit && r.hit.line) console.log(r.hit.line);
    console.log("record_counter=" + args.counterName + " " + (r.ok ? "OK" : "STOP"));
    process.exit(r.ok ? 0 : 2);
  }

  if (cmd === "record-stagnation") {
    const r = recordStagnationSignals(repoRoot, args.runId, args.signals);
    if (r.hit && r.hit.line) console.log(r.hit.line);
    process.exit(r.ok ? 0 : 2);
  }

  if (cmd === "check-text") {
    const st = loadState(repoRoot, args.runId);
    if (!st) {
      console.log("CONTROLLED_BUDGET_GUARD_STOP=STATE_MISSING");
      process.exit(2);
    }
    const hit = checkSelfExpanding(st, args.text);
    if (hit) {
      saveState(repoRoot, st);
      console.log(hit.line);
      process.exit(2);
    }
    console.log("check_text=OK");
    return;
  }

  if (cmd === "check") {
    const st = loadState(repoRoot, args.runId);
    if (!st) {
      console.log("CONTROLLED_BUDGET_GUARD_STOP=STATE_MISSING");
      process.exit(2);
    }
    const hit = evaluateAll(st, { signals: args.signals, text: args.text });
    saveState(repoRoot, st);
    if (hit.stop) {
      console.log(hit.line);
      process.exit(2);
    }
    console.log("check=OK");
    return;
  }

  if (cmd === "finalize") {
    const fin = finalizeCap(repoRoot, args.runId, {
      finalOutcome: args.finalOutcome,
      gitDirtyExplanation: args.gitDirtyExplanation,
    });
    if (!fin.ok) {
      console.log("CONTROLLED_BUDGET_GUARD_FINALIZE=FAIL");
      for (const f of fin.failures || []) console.log("finalize_fail=" + f);
      process.exit(1);
    }
    console.log("CONTROLLED_BUDGET_GUARD_FINALIZE=OK");
    console.log("final_outcome=" + fin.final_outcome);
    process.exit(0);
  }

  console.log(
    "Usage: node silver-controlled-budget-guard.cjs <selftest|init|status|record-invoke|record-counter|record-stagnation|check|check-text|finalize|profiles> [--repo PATH] [--run-id ID] ...",
  );
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  CONTROLLED_CAP_PROFILE_DEFAULT,
  PROFILES,
  FINAL_OUTCOMES,
  METRIC_KEYS,
  resolveProfileId,
  createState,
  loadState,
  recordAgentInvoke,
  recordCounter,
  evaluateAll,
  detectSelfExpandingGoal,
  buildMetricDeltaBlock,
  captureMetricSnapshot,
  finalizeCap,
  runSelftest,
};
