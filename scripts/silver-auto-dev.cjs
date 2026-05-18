#!/usr/bin/env node
/**
 * Silver Auto-Dev V1 — single-pass entrypoint: bounded safe PR queue, then deterministic
 * SILVER_NEXT_ACTION.md handoff when no ultra-safe PR candidate remains.
 * Optional `--run-cursor`: invokes `scripts/silver-cursor-agent-adapter.ps1` once when
 * `--max-cycles=1` (default) without `--loop`. With `--loop --max-cycles=N` (N=1..HARD_SAFE_MAX_CYCLES),
 * runs up to N bounded cycles with existing runtime safety gates. Does not modify
 * assets/app.js or the Silver engine.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const plannerHandoff = require("./silver-next-action-planner-handoff.cjs");

const REPO = path.resolve(__dirname, "..");
const ORCHESTRATOR_SCRIPT = path.join(__dirname, "silver-pr-orchestrator-v1.cjs");
const ORCHESTRATOR_REPORT = path.join(__dirname, "silver-pr-orchestrator-v1-report.json");
const DEV_REPORT = path.join(__dirname, "silver-auto-dev-report.json");
const NEXT_ACTION_FILE = path.join(REPO, "SILVER_NEXT_ACTION.md");
const ADAPTER_PS1 = path.join(__dirname, "silver-cursor-agent-adapter.ps1");
const CURSOR_ADAPTER_DIAGNOSTIC_JSON = path.join(
  __dirname,
  "silver-cursor-agent-adapter-diagnostic-report.json",
);
const MAX_BUFFER = 64 * 1024 * 1024;
/** Absolute ceiling for `--loop --max-cycles=N` (user request must be <= this). */
const HARD_SAFE_MAX_CYCLES = 100;
const LOOP_GUARD_VERSION = "CONTROLLED_LOOP_V5_HANDOFF_TRANCHE";
/** Full-agent handoff cycles per tranche; short WSL stdin probes only after each tranche start. */
const LOOP_LONG_RUN_TRANCHE_SIZE = 20;
/** Max consecutive probe cycles immediately after each tranche handoff (health/stability only). */
const LOOP_PROBE_CYCLES_PER_TRANCHE = 2;
const ADAPTER_TIMEOUT_SINGLE_SEC = 3200;
const ADAPTER_TIMEOUT_LOOP_BASE_SEC = 3200;
const ADAPTER_TIMEOUT_LOOP_PROBE_SEC = 180;
const ADAPTER_TIMEOUT_LOOP_CAP_SEC = 7200;
const LOOP_PROBE_TASK_FILE = "scripts/silver-wsl-taskfile-stdin-probe-task.md";
const CURSOR_OUTPUT_FILE = path.join(REPO, "SILVER_CURSOR_OUTPUT.md");
const LOOP_RUNTIME_ALLOWED_DIRTY_PATHS = new Set([
  "SILVER_CURSOR_OUTPUT.md",
  "SILVER_NEXT_ACTION.md",
  "SILVER_RUN_REPORT.md",
  "scripts/silver-auto-dev-report.json",
  "scripts/silver-pr-orchestrator-v1-report.json",
  "scripts/silver-cursor-agent-adapter-diagnostic-report.json",
]);

/** Handoff artifacts kept on disk after a successful loop for manual CAP review (never git checkout). */
const LOOP_HANDOFF_PERSIST_PATHS = new Set([
  "SILVER_CURSOR_OUTPUT.md",
  "SILVER_NEXT_ACTION.md",
]);

/** Runtime JSON/report paths restored after loop so the working tree stays clean. */
const LOOP_RUNTIME_RESTORE_ON_EXIT_PATHS = new Set(
  [...LOOP_RUNTIME_ALLOWED_DIRTY_PATHS].filter((p) => !LOOP_HANDOFF_PERSIST_PATHS.has(p)),
);

const {
  pickTopClusterDiagnostic,
  buildHandoffMarkdown,
  silverNextActionHasClusterWorkflow,
  silverNextActionQualityViolations,
  runPlannerClusterPreferenceSelftest,
} = plannerHandoff;

/** Regenerated Silver diagnostic JSON under scripts/ only (narrow; not source or engine paths). */
const LOOP_RUNTIME_GENERATED_DIAGNOSTIC_REPORT_RE =
  /^scripts\/silver-[a-z0-9][a-z0-9_-]*-diagnostic-report\.json$/i;

/** Regenerated cluster-classifier JSON under scripts/ (runtime-only; not engine paths). */
const LOOP_RUNTIME_GENERATED_CLUSTER_CLASSIFIER_REPORT_RE =
  /^scripts\/silver-[a-z0-9][a-z0-9_-]*-cluster-classifier-v\d+-report\.json$/i;

/**
 * @param {string} rel
 * @returns {string}
 */
function normalizeLoopRuntimeRepoRel(rel) {
  return String(rel || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
}

/**
 * @param {string} rel
 * @returns {boolean}
 */
function isLoopRuntimeAllowedGeneratedDiagnosticReport(rel) {
  const p = normalizeLoopRuntimeRepoRel(rel);
  if (!p || p.includes("..")) return false;
  return LOOP_RUNTIME_GENERATED_DIAGNOSTIC_REPORT_RE.test(p);
}

/**
 * @param {string} rel
 * @returns {boolean}
 */
function isLoopRuntimeAllowedGeneratedClusterClassifierReport(rel) {
  const p = normalizeLoopRuntimeRepoRel(rel);
  if (!p || p.includes("..")) return false;
  return LOOP_RUNTIME_GENERATED_CLUSTER_CLASSIFIER_REPORT_RE.test(p);
}

/**
 * @param {string} rel
 * @returns {boolean}
 */
function isLoopRuntimeAllowedGeneratedScriptReport(rel) {
  return (
    isLoopRuntimeAllowedGeneratedDiagnosticReport(rel) ||
    isLoopRuntimeAllowedGeneratedClusterClassifierReport(rel)
  );
}

/**
 * @param {string} rel
 * @returns {boolean}
 */
function isLoopRuntimeAllowedDirtyPath(rel) {
  const p = normalizeLoopRuntimeRepoRel(rel);
  if (!p) return false;
  if (LOOP_RUNTIME_ALLOWED_DIRTY_PATHS.has(p)) return true;
  return isLoopRuntimeAllowedGeneratedScriptReport(p);
}

function runCommand(cmd, args, options) {
  const opts = {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  };
  try {
    const stdout = execFileSync(cmd, args, opts);
    return { ok: true, stdout: String(stdout || ""), stderr: "", exitCode: 0 };
  } catch (e) {
    const stderr = e.stderr != null ? String(e.stderr) : "";
    const stdout = e.stdout != null ? String(e.stdout) : "";
    const exitCode = typeof e.status === "number" ? e.status : 1;
    const msg = stderr.trim() || String(e.message || e || "command_failed");
    return { ok: false, stdout, stderr, exitCode, message: msg };
  }
}

function gitPorcelain() {
  const r = runCommand("git", ["status", "--porcelain"]);
  if (!r.ok) return { ok: false, text: "", err: r.message || r.stderr };
  return { ok: true, text: r.stdout };
}

function isStrictCleanPorcelain(text) {
  return String(text || "").trim().length === 0;
}

function gitBranch() {
  const r = runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!r.ok) return "";
  return String(r.stdout || "").trim();
}

function gitHead() {
  const r = runCommand("git", ["rev-parse", "HEAD"]);
  if (!r.ok) return "";
  return String(r.stdout || "").trim();
}

function gitDiffPathNonEmpty(rel) {
  const r = runCommand("git", ["diff", "--", rel]);
  if (!r.ok) return { ok: false, nonEmpty: true };
  const r2 = runCommand("git", ["diff", "--cached", "--", rel]);
  if (!r2.ok) return { ok: false, nonEmpty: true };
  const a = String(r.stdout || "").trim().length > 0;
  const b = String(r2.stdout || "").trim().length > 0;
  return { ok: true, nonEmpty: a || b };
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function dirtyPathsFromPorcelain(text) {
  const out = [];
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    if (line.length < 4) continue;
    const rawPath = line.slice(3).trim();
    if (!rawPath) continue;
    const renamedTo = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() : rawPath;
    const p = String(renamedTo || "").trim();
    if (p) out.push(p);
  }
  return out;
}

/**
 * @returns {{ ok: boolean, gitClean: "YES"|"NO", dirtyPaths: string[], outsideAllowed: string[], reason: string }}
 */
function evaluateLoopRuntimeSafety() {
  const p = gitPorcelain();
  if (!p.ok) {
    return {
      ok: false,
      gitClean: "NO",
      dirtyPaths: [],
      outsideAllowed: [],
      reason: p.err || "GIT_STATUS_FAILED",
    };
  }
  const dirtyPaths = dirtyPathsFromPorcelain(p.text);
  const outsideAllowed = dirtyPaths.filter((x) => !isLoopRuntimeAllowedDirtyPath(x));
  return {
    ok: true,
    gitClean: outsideAllowed.length === 0 ? "YES" : "NO",
    dirtyPaths,
    outsideAllowed,
    reason: "",
  };
}

function npmAvailable() {
  if (process.platform === "win32") {
    const r = runCommand("cmd.exe", ["/d", "/s", "/c", "npm --version"]);
    return r.ok && String(r.stdout || "").trim().length > 0;
  }
  const r = runCommand("npm", ["--version"]);
  return r.ok && String(r.stdout || "").trim().length > 0;
}

function readJsonFile(abs) {
  try {
    if (!fs.existsSync(abs)) {
      return { ok: false, data: null, message: `missing:${path.relative(REPO, abs)}` };
    }
    const raw = fs.readFileSync(abs, "utf8");
    return { ok: true, data: JSON.parse(raw), message: "" };
  } catch (e) {
    return { ok: false, data: null, message: String(e.message || e || "json_read_failed") };
  }
}

function yn(b) {
  return b ? "YES" : "NO";
}

function maxCyclesGuardReport(cli) {
  if (!cli.runCursor) return "";
  return cli.maxCyclesError ? "FAIL" : "PASS";
}

/**
 * @param {{ runCursor: boolean, loopMode: boolean, maxCycles: string, maxCyclesError: string, maxCyclesRaw: string|null }} cli
 * @returns {{ hard_safe_max_cycles: string, requested_max_cycles: string, effective_max_cycles: string }}
 */
function loopGuardMetaFromCli(cli) {
  const hard = String(HARD_SAFE_MAX_CYCLES);
  if (!cli.runCursor) {
    return { hard_safe_max_cycles: "", requested_max_cycles: "", effective_max_cycles: "" };
  }
  let requested = "";
  let effective = "";
  if (cli.loopMode) {
    if (cli.maxCyclesRaw != null && String(cli.maxCyclesRaw).trim() !== "") {
      requested = String(cli.maxCyclesRaw).trim();
    } else if (!cli.maxCyclesError && cli.maxCycles) {
      requested = cli.maxCycles;
    }
    if (!cli.maxCyclesError && cli.maxCycles) {
      effective = cli.maxCycles;
    }
  } else {
    requested =
      cli.maxCyclesRaw == null || String(cli.maxCyclesRaw).trim() === ""
        ? "1"
        : String(cli.maxCyclesRaw).trim();
    if (!cli.maxCyclesError) {
      effective = cli.maxCycles || "1";
    }
  }
  return { hard_safe_max_cycles: hard, requested_max_cycles: requested, effective_max_cycles: effective };
}

/**
 * @returns {{ runCursor: boolean, loopMode: boolean, maxCycles: string, maxCyclesError: string, maxCyclesRaw: string|null }}
 */
function parseSilverAutoCli(argv) {
  const runCursor = argv.includes("--run-cursor");
  const loopMode = argv.includes("--loop");
  let maxCyclesRaw = null;
  for (const a of argv) {
    if (a.startsWith("--max-cycles=")) {
      maxCyclesRaw = a.slice("--max-cycles=".length);
      break;
    }
  }
  let maxCyclesError = "";
  let maxCycles = "";
  if (loopMode && !runCursor) {
    maxCyclesError = "LOOP_REQUIRES_RUN_CURSOR";
  } else if (loopMode) {
    if (maxCyclesRaw == null || maxCyclesRaw === "") {
      maxCyclesError = "LOOP_REQUIRES_MAX_CYCLES";
    } else {
      const trimmed = String(maxCyclesRaw).trim();
      const n = parseInt(trimmed, 10);
      if (!Number.isFinite(n) || String(n) !== trimmed) {
        maxCyclesError = "INVALID_MAX_CYCLES";
      } else if (n <= 0) {
        maxCyclesError = "MAX_CYCLES_ZERO_FORBIDDEN";
      } else if (n > HARD_SAFE_MAX_CYCLES) {
        maxCyclesError = "MAX_CYCLES_EXCEEDS_HARD_SAFE_LIMIT";
      } else {
        maxCycles = String(n);
      }
    }
  } else if (runCursor) {
    if (maxCyclesRaw == null || maxCyclesRaw === "") {
      maxCycles = "1";
    } else {
      const trimmed = String(maxCyclesRaw).trim();
      const n = parseInt(trimmed, 10);
      if (!Number.isFinite(n) || String(n) !== trimmed) {
        maxCyclesError = "INVALID_MAX_CYCLES";
      } else if (n <= 0) {
        maxCyclesError = "MAX_CYCLES_ZERO_FORBIDDEN";
      } else if (n !== 1) {
        maxCyclesError = "MAX_CYCLES_V1_ONLY_1";
      } else {
        maxCycles = "1";
      }
    }
  }
  return { runCursor, loopMode, maxCycles, maxCyclesError, maxCyclesRaw };
}

/**
 * @returns {boolean}
 */
function runCliLoopGuardSelftest() {
  const t = (argv, wantErr) => {
    const cli = parseSilverAutoCli(argv);
    const got = cli.maxCyclesError || "";
    if (got !== wantErr) {
      console.error(
        `CLI_LOOP_GUARD_SELFTEST_FAIL argv=${JSON.stringify(argv)} want_err=${JSON.stringify(wantErr)} got=${JSON.stringify(got)}`,
      );
      return false;
    }
    return true;
  };
  const all =
    t(["--run-cursor", "--max-cycles=3"], "MAX_CYCLES_V1_ONLY_1") &&
    t(["--run-cursor", "--max-cycles=4"], "MAX_CYCLES_V1_ONLY_1") &&
    t(["--run-cursor", "--loop", "--max-cycles=2"], "") &&
    t(["--run-cursor", "--loop", "--max-cycles=3"], "") &&
    t(["--run-cursor", "--loop", "--max-cycles=4"], "") &&
    t(["--run-cursor", "--loop", "--max-cycles=50"], "") &&
    t(["--run-cursor", "--loop", "--max-cycles=100"], "") &&
    t(["--run-cursor", "--loop", "--max-cycles=101"], "MAX_CYCLES_EXCEEDS_HARD_SAFE_LIMIT") &&
    t(["--run-cursor", "--loop", "--max-cycles=0"], "MAX_CYCLES_ZERO_FORBIDDEN") &&
    t(["--run-cursor", "--max-cycles=0"], "MAX_CYCLES_ZERO_FORBIDDEN") &&
    t(["--run-cursor", "--loop", "--max-cycles=1"], "") &&
    t(["--run-cursor", "--max-cycles=1"], "") &&
    t(["--run-cursor"], "");
  if (all) console.log("CLI_LOOP_GUARD_SELFTEST_PASS");
  return all;
}

function cursorSchemaDefaults(cli) {
  const loopMeta = loopGuardMetaFromCli(cli);
  return {
    cursor_adapter_mode: cli.runCursor ? "RUN_CURSOR_V1" : "OFF",
    cursor_adapter_available: "NO",
    cursor_adapter_executed: "NO",
    cursor_exit_code: "",
    cursor_adapter_wsl_ubuntu: "",
    cursor_diagnostic_wsl_ready: "",
    cursor_output_file: "SILVER_CURSOR_OUTPUT.md",
    max_cycles: cli.runCursor ? cli.maxCycles || "1" : "",
    loop_mode: cli.loopMode ? "YES" : "NO",
    loop_max_cycles: cli.loopMode ? cli.maxCycles : "",
    hard_safe_max_cycles: loopMeta.hard_safe_max_cycles,
    requested_max_cycles: loopMeta.requested_max_cycles,
    effective_max_cycles: loopMeta.effective_max_cycles,
    loop_guard_version: LOOP_GUARD_VERSION,
    max_cycles_guard_result: maxCyclesGuardReport(cli),
    loop_cycles_completed: cli.loopMode ? "0" : "",
    loop_stop_reason: "",
    loop_safe_to_continue: "",
    loop_completed: cli.loopMode ? "NO" : "",
  };
}

function withCursorSchema(repOut, cli) {
  return { ...cursorSchemaDefaults(cli), ...repOut };
}

/**
 * @returns {{ ok: boolean, reason: string, shell: string, fileArgs: string[] }}
 */
function discoverCursorAdapter() {
  if (!fs.existsSync(ADAPTER_PS1)) {
    return { ok: false, reason: "adapter_script_missing", shell: "", fileArgs: [] };
  }
  if (process.platform === "win32") {
    return {
      ok: true,
      reason: "",
      shell: "powershell.exe",
      fileArgs: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ADAPTER_PS1],
    };
  }
  const pw = runCommand("pwsh", ["-NoLogo", "-NoProfile", "-Command", "exit 0"]);
  if (pw.ok) {
    return {
      ok: true,
      reason: "",
      shell: "pwsh",
      fileArgs: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ADAPTER_PS1],
    };
  }
  return { ok: false, reason: "pwsh_not_found_non_windows", shell: "", fileArgs: [] };
}

/**
 * When Windows Cursor CLI is not adapter_ready (no headless marker), Silver may still
 * run the verified WSL `agent --print --mode ask --trust --workspace` path (see diagnostic).
 * @returns {"YES"|"NO"|"UNKNOWN"}
 */
function readWslCursorAdapterReadyFromDiagnostic() {
  const parsed = readJsonFile(CURSOR_ADAPTER_DIAGNOSTIC_JSON);
  if (!parsed.ok || !parsed.data || typeof parsed.data !== "object") {
    return "UNKNOWN";
  }
  const w = parsed.data.wsl_cursor_agent_print_ask_trust;
  if (!w || typeof w !== "object") {
    return "UNKNOWN";
  }
  const s = w.adapter_ready;
  if (s === "YES" || s === "NO") {
    return s;
  }
  return "UNKNOWN";
}

/** @param {string} winAbs */
function repoRootWindowsToWslMnt(winAbs) {
  const norm = path.resolve(String(winAbs || ""));
  const m = /^([A-Za-z]):([\\/].*)$/.exec(norm);
  if (!m) {
    return "";
  }
  const letter = m[1].toLowerCase();
  const tail = m[2].replace(/^[\\/]+/, "").split(/[\\/]+/).filter(Boolean).join("/");
  return `/mnt/${letter}/${tail}`;
}

/**
 * @param {number} cycle
 * @returns {number} 1-based position within the current 20-cycle tranche
 */
function loopCyclePositionInTranche(cycle) {
  return ((cycle - 1) % LOOP_LONG_RUN_TRANCHE_SIZE) + 1;
}

/**
 * Per-cycle adapter plan for controlled loop.
 * Each tranche starts with FULL_AGENT_HANDOFF (SILVER_NEXT_ACTION.md), then at most
 * LOOP_PROBE_CYCLES_PER_TRANCHE fast WSL stdin probes, then execution handoff for the rest.
 * Avoids V4 stall where cycles 2..N were all probes and no cluster work ran.
 * @param {number} loopTarget
 * @param {number} cycle
 */
function resolveLoopCycleAdapterPlan(loopTarget, cycle) {
  const posInTranche = loopCyclePositionInTranche(cycle);
  const isTrancheHandoff = posInTranche === 1;
  const isProbeWindow =
    posInTranche > 1 && posInTranche <= 1 + LOOP_PROBE_CYCLES_PER_TRANCHE;
  let timeoutSeconds = ADAPTER_TIMEOUT_LOOP_BASE_SEC;
  if (loopTarget > LOOP_LONG_RUN_TRANCHE_SIZE) {
    timeoutSeconds = Math.min(ADAPTER_TIMEOUT_LOOP_CAP_SEC, ADAPTER_TIMEOUT_LOOP_BASE_SEC + 400);
  }
  if (isTrancheHandoff || !isProbeWindow) {
    return {
      useProbe: false,
      taskFile: "SILVER_NEXT_ACTION.md",
      timeoutSeconds,
      cycle_mode: "FULL_AGENT_HANDOFF",
    };
  }
  const longRunProbe =
    loopTarget > LOOP_LONG_RUN_TRANCHE_SIZE && cycle > LOOP_LONG_RUN_TRANCHE_SIZE;
  return {
    useProbe: true,
    taskFile: LOOP_PROBE_TASK_FILE,
    timeoutSeconds: ADAPTER_TIMEOUT_LOOP_PROBE_SEC,
    cycle_mode: longRunProbe ? "WSL_STDIN_PROBE_LONG_RUN" : "WSL_STDIN_PROBE_STABILITY",
  };
}

/**
 * @returns {boolean}
 */
function runCyclePlanSelftest() {
  const expect = (loopTarget, cycle, wantMode, wantProbe) => {
    const plan = resolveLoopCycleAdapterPlan(loopTarget, cycle);
    if (plan.cycle_mode !== wantMode || plan.useProbe !== wantProbe) {
      console.error(
        `CYCLE_PLAN_SELFTEST_FAIL target=${loopTarget} cycle=${cycle} want_mode=${wantMode} want_probe=${wantProbe} got_mode=${plan.cycle_mode} got_probe=${plan.useProbe}`,
      );
      return false;
    }
    return true;
  };
  let ok = true;
  ok =
    expect(50, 1, "FULL_AGENT_HANDOFF", false) &&
    expect(50, 2, "WSL_STDIN_PROBE_STABILITY", true) &&
    expect(50, 3, "WSL_STDIN_PROBE_STABILITY", true) &&
    expect(50, 4, "FULL_AGENT_HANDOFF", false) &&
    expect(50, 20, "FULL_AGENT_HANDOFF", false) &&
    expect(50, 21, "FULL_AGENT_HANDOFF", false) &&
    expect(50, 22, "WSL_STDIN_PROBE_LONG_RUN", true) &&
    expect(50, 23, "WSL_STDIN_PROBE_LONG_RUN", true) &&
    expect(50, 24, "FULL_AGENT_HANDOFF", false) &&
    ok;
  let handoff50 = 0;
  let probe50 = 0;
  for (let c = 1; c <= 50; c += 1) {
    const p = resolveLoopCycleAdapterPlan(50, c);
    if (p.useProbe) probe50 += 1;
    else handoff50 += 1;
  }
  if (handoff50 < 40 || probe50 > 8) {
    console.error(
      `CYCLE_PLAN_SELFTEST_FAIL cap50_balance handoff=${handoff50} probe=${probe50} want_handoff>=40 probe<=8`,
    );
    ok = false;
  }
  if (ok) console.log("CYCLE_PLAN_SELFTEST_PASS");
  return ok;
}

/**
 * @param {number} loopTarget
 * @returns {number}
 */
function resolveSingleRunAdapterTimeoutSeconds(loopTarget) {
  if (loopTarget > LOOP_LONG_RUN_TRANCHE_SIZE) {
    return Math.min(ADAPTER_TIMEOUT_LOOP_CAP_SEC, ADAPTER_TIMEOUT_LOOP_BASE_SEC + 400);
  }
  return ADAPTER_TIMEOUT_SINGLE_SEC;
}

function readTextFileCharCount(absPath) {
  try {
    if (!fs.existsSync(absPath)) return 0;
    return fs.readFileSync(absPath, "utf8").length;
  } catch {
    return 0;
  }
}

/**
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseAdapterOutputMeta(text) {
  const out = {};
  const lines = String(text || "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (
      key === "timed_out" ||
      key === "elapsed_ms" ||
      key === "timeout_seconds" ||
      key === "exit_code" ||
      key === "task_digest"
    ) {
      out[key] = line.slice(idx + 1).trim();
    }
    if (line.startsWith("# stdout")) break;
  }
  return out;
}

/**
 * @param {Record<string, string|number>} hb
 */
function printLoopCycleHeartbeat(hb) {
  console.log("=== SILVER_AUTO_LOOP_CYCLE_HEARTBEAT ===");
  for (const k of [
    "current_loop_cycle",
    "last_completed_cycle",
    "loop_max_cycles",
    "cycle_mode",
    "elapsed_ms_total",
    "elapsed_ms_current_cycle",
    "cursor_call_started_at",
    "cursor_call_finished_at",
    "cursor_call_duration_ms",
    "effective_timeout_seconds",
    "next_action_size_chars",
    "cursor_output_size_chars",
  ]) {
    if (hb[k] != null && hb[k] !== "") {
      console.log(`${k}=${String(hb[k])}`);
    }
  }
  console.log("=== END_SILVER_AUTO_LOOP_CYCLE_HEARTBEAT ===");
}

/**
 * @param {string} text
 * @returns {string[]}
 */
/**
 * @param {{ mainCommit: string, queueReport: object|null, clusterDiag: object }} ctx
 * @returns {string}
 */
function buildDeterministicClusterHandoffMarkdown(ctx) {
  return buildHandoffMarkdown(ctx);
}

/**
 * @returns {{ ok: boolean, text: string, violations: string[] }}
 */
function readSilverNextActionQuality() {
  let text = "";
  try {
    if (fs.existsSync(NEXT_ACTION_FILE)) text = fs.readFileSync(NEXT_ACTION_FILE, "utf8");
  } catch {
    return { ok: false, text: "", violations: ["next_action_read_failed"] };
  }
  const violations = silverNextActionQualityViolations(text);
  return { ok: true, text, violations };
}

/**
 * @param {{ mainCommit: string, queueReport: object|null, clusterDiag: object }} ctx
 * @returns {"YES"|"NO"}
 */
function regenerateDeterministicClusterNextAction(ctx) {
  fs.writeFileSync(NEXT_ACTION_FILE, buildDeterministicClusterHandoffMarkdown(ctx), "utf8");
  return "YES";
}

/**
 * @param {{ mainCommit: string, queueReport: object|null, clusterDiag: object }} ctx
 * @returns {{ ok: boolean, violations: string[], regenerated: "YES"|"NO" }}
 */
function enforceDeterministicClusterNextAction(ctx) {
  const read0 = readSilverNextActionQuality();
  if (!read0.ok) return { ok: false, violations: read0.violations, regenerated: "NO" };
  if (!read0.violations.length) return { ok: true, violations: [], regenerated: "NO" };
  regenerateDeterministicClusterNextAction(ctx);
  const read1 = readSilverNextActionQuality();
  if (!read1.ok) return { ok: false, violations: read1.violations, regenerated: "YES" };
  return {
    ok: read1.violations.length === 0,
    violations: read1.violations.length ? read1.violations : read0.violations,
    regenerated: "YES",
  };
}

/**
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseAdapterOutputMetaFull(text) {
  const out = {};
  const full = String(text || "");
  if (full.indexOf("# silver-cursor-agent-adapter") < 0) return out;
  const marker = "# stdout";
  const idx = full.indexOf(marker);
  const head = idx >= 0 ? full.slice(0, idx) : full;
  for (const raw of head.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    if (!/^[a-zA-Z0-9_]+$/.test(k)) continue;
    out[k] = line.slice(eq + 1).trim();
  }
  return out;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function cursorOutputPersistenceViolations(text) {
  const full = String(text || "");
  const v = [];
  if (!full.trim()) {
    v.push("cursor_output_missing");
    return v;
  }
  const meta = parseAdapterOutputMetaFull(full);
  if (String(meta.adapter_output_state || "") === "INVALIDATED_AWAITING_CYCLE") {
    v.push("invalidated_awaiting_cycle");
  }
  const stdoutMarker = "# stdout";
  const idx = full.indexOf(stdoutMarker);
  const tail = idx >= 0 ? full.slice(idx + stdoutMarker.length) : "";
  const stderrMarker = "# stderr";
  const stderrIdx = tail.indexOf(stderrMarker);
  const stdoutBody = (stderrIdx >= 0 ? tail.slice(0, stderrIdx) : tail).replace(/\s/g, "");
  if (stdoutBody.length < 20 && String(meta.stdout_nonempty || "").toUpperCase() !== "YES") {
    v.push("cursor_stdout_empty");
  }
  return v;
}

/**
 * @returns {boolean}
 */
/**
 * @returns {boolean}
 */
function runRuntimeArtifactSelftest() {
  let ok = true;
  const cases = [
    ["scripts/silver-rhc3-cluster-classifier-v1-report.json", true],
    ["scripts/silver-rcz2-mobile-voice-intent-fail-diagnostic-report.json", true],
    ["scripts/silver-pr-orchestrator-v1-report.json", true],
    ["assets/app.js", false],
    ["scripts/silver-autopilot.cjs", false],
  ];
  for (const [rel, want] of cases) {
    const got = isLoopRuntimeAllowedDirtyPath(rel);
    if (got !== want) {
      console.error(`RUNTIME_ARTIFACT_SELFTEST_FAIL rel=${rel} want=${want} got=${got}`);
      ok = false;
    }
  }
  if (ok) console.log("RUNTIME_ARTIFACT_SELFTEST_PASS");
  return ok;
}

/**
 * CAP5 proxy: regenerate classifier report and assert loop runtime guard allows it.
 * @returns {boolean}
 */
function runLoopRuntimeDirtySelftest() {
  const classifierRel = "scripts/silver-rhc3-cluster-classifier-v1-report.json";
  const gen = runCommand(process.execPath, [
    path.join(__dirname, "silver-rhc3-cluster-classifier-v1.cjs"),
  ]);
  if (!gen.ok) {
    console.error("LOOP_RUNTIME_DIRTY_SELFTEST_FAIL classifier_exit=" + String(gen.exitCode));
    return false;
  }
  const runtime = evaluateLoopRuntimeSafety();
  if (!runtime.ok) {
    console.error("LOOP_RUNTIME_DIRTY_SELFTEST_FAIL git_status=" + runtime.reason);
    return false;
  }
  if (runtime.outsideAllowed.length > 0) {
    console.error(
      "LOOP_RUNTIME_DIRTY_SELFTEST_FAIL outside=" + runtime.outsideAllowed.join(","),
    );
    runCommand("git", ["checkout", "--", classifierRel]);
    return false;
  }
  const hasClassifier = runtime.dirtyPaths.some(
    (p) => normalizeLoopRuntimeRepoRel(p) === classifierRel,
  );
  if (!hasClassifier) {
    console.error("LOOP_RUNTIME_DIRTY_SELFTEST_FAIL classifier_not_dirty");
    runCommand("git", ["checkout", "--", classifierRel]);
    return false;
  }
  runCommand("git", ["checkout", "--", classifierRel]);
  console.log("LOOP_RUNTIME_DIRTY_SELFTEST_PASS");
  return true;
}

function runHandoffPersistenceSelftest() {
  let ok = true;
  const badMoji = silverNextActionQualityViolations("ĂšKOL PRO CURSOR â€” git push -u origin chore/silver-audit-repo-state");
  if (!badMoji.length) {
    console.error("HANDOFF_PERSISTENCE_SELFTEST_FAIL mojibake_generic_expected");
    ok = false;
  }
  const goodCluster = silverNextActionQualityViolations(
    "ÚKOL PRO CURSOR — NEXT PRODUCT CLUSTER\nnode scripts/silver-rhc3-top-cluster-diagnostic.cjs",
  );
  if (goodCluster.length) {
    console.error("HANDOFF_PERSISTENCE_SELFTEST_FAIL cluster_task_rejected " + goodCluster.join(";"));
    ok = false;
  }
  const genericGh = silverNextActionQualityViolations(
    "<!-- SILVER_NEXT_ACTION: full-auto-loop-openai -->\nsudo apt update\ngh auth login\nnode scripts/silver-autopilot.cjs --verify-pr=3794",
  );
  if (!genericGh.length) {
    console.error("HANDOFF_PERSISTENCE_SELFTEST_FAIL generic_gh_verify_expected");
    ok = false;
  }
  if (!isLoopRuntimeAllowedGeneratedClusterClassifierReport("scripts/silver-rhc3-cluster-classifier-v1-report.json")) {
    console.error("HANDOFF_PERSISTENCE_SELFTEST_FAIL classifier_report_not_allowed");
    ok = false;
  }
  const inv = cursorOutputPersistenceViolations(
    "# silver-cursor-agent-adapter\nadapter_output_state=INVALIDATED_AWAITING_CYCLE\n# stdout\n\n",
  );
  if (!inv.includes("invalidated_awaiting_cycle")) {
    console.error("HANDOFF_PERSISTENCE_SELFTEST_FAIL invalidated_guard");
    ok = false;
  }
  const done = cursorOutputPersistenceViolations(
    "# silver-cursor-agent-adapter\nadapter_output_state=COMPLETED\nstdout_nonempty=YES\n# stdout\n" +
      "x".repeat(25) +
      "\n",
  );
  if (done.length) {
    console.error("HANDOFF_PERSISTENCE_SELFTEST_FAIL completed_should_pass " + done.join(";"));
    ok = false;
  }
  if (!LOOP_HANDOFF_PERSIST_PATHS.has("SILVER_CURSOR_OUTPUT.md")) {
    console.error("HANDOFF_PERSISTENCE_SELFTEST_FAIL persist_set");
    ok = false;
  }
  if (LOOP_RUNTIME_RESTORE_ON_EXIT_PATHS.has("SILVER_CURSOR_OUTPUT.md")) {
    console.error("HANDOFF_PERSISTENCE_SELFTEST_FAIL restore_set_excludes_handoff");
    ok = false;
  }
  if (ok) console.log("HANDOFF_PERSISTENCE_SELFTEST_PASS");
  return ok;
}

function restoreLoopRuntimeFiles() {
  for (const rel of LOOP_RUNTIME_RESTORE_ON_EXIT_PATHS) {
    runCommand("git", ["checkout", "--", rel]);
  }
  const p = gitPorcelain();
  if (!p.ok) return;
  for (const rel of dirtyPathsFromPorcelain(p.text)) {
    if (isLoopRuntimeAllowedGeneratedScriptReport(rel)) {
      runCommand("git", ["checkout", "--", rel]);
    }
  }
}

/**
 * @param {number} loopTarget
 * @param {number} completed
 * @param {string} loopSafe
 * @returns {{ ok: boolean, stopReason: string, detail: string }}
 */
function evaluateLoopHandoffPersistence(loopTarget, completed, loopSafe) {
  if (loopSafe !== "YES" || completed !== loopTarget) {
    return { ok: true, stopReason: "", detail: "" };
  }
  let cursorText = "";
  let nextText = "";
  try {
    if (fs.existsSync(CURSOR_OUTPUT_FILE)) cursorText = fs.readFileSync(CURSOR_OUTPUT_FILE, "utf8");
    if (fs.existsSync(NEXT_ACTION_FILE)) nextText = fs.readFileSync(NEXT_ACTION_FILE, "utf8");
  } catch (e) {
    return {
      ok: false,
      stopReason: "HANDOFF_PERSISTENCE_READ_FAILED",
      detail: String((e && e.message) || e || "read_failed"),
    };
  }
  const cv = cursorOutputPersistenceViolations(cursorText);
  const nv = silverNextActionQualityViolations(nextText);
  if (cv.length || nv.length) {
    return {
      ok: false,
      stopReason: "HANDOFF_PERSISTENCE_GUARD_FAIL",
      detail: "cursor=" + cv.join(",") + ";next_action=" + nv.join(","),
    };
  }
  return { ok: true, stopReason: "", detail: "" };
}

function runSilverCursorAdapter(adapter, opts) {
  const useWsl = Boolean(opts && opts.useWslUbuntuAgent);
  const useProbe = Boolean(opts && opts.useProbe);
  const taskFile = String((opts && opts.taskFile) || "SILVER_NEXT_ACTION.md");
  const timeoutSeconds =
    opts && opts.timeoutSeconds != null ? Number(opts.timeoutSeconds) : ADAPTER_TIMEOUT_SINGLE_SEC;
  const args = [...adapter.fileArgs];
  if (useWsl) {
    args.push("-WslUbuntuAgent");
    const wslWs = repoRootWindowsToWslMnt(REPO);
    if (wslWs) {
      args.push("-WslWorkspaceLinuxPath", wslWs);
    }
  }
  if (useProbe) {
    args.push("-Probe");
  }
  args.push(
    "-TaskFile",
    taskFile,
    "-OutputFile",
    "SILVER_CURSOR_OUTPUT.md",
    "-TimeoutSeconds",
    String(timeoutSeconds),
  );
  return runCommand(adapter.shell, args);
}

function safePrAvailableFromQueue(rep) {
  if (!rep || typeof rep !== "object") return "NO";
  const n = Number(rep.safe_open_candidates);
  if (Number.isFinite(n) && n > 0) return "YES";
  if (rep.recommended_first_safe_candidate != null && rep.recommended_first_safe_candidate !== "") {
    return "YES";
  }
  return "NO";
}

function queueDidMergeOrSync(rep) {
  if (!rep || typeof rep !== "object") return false;
  const mergeOk = rep.apply_merge_attempted === "YES" && rep.apply_merge_result === "PASS";
  const syncOk = rep.apply_sync_attempted === "YES" && rep.apply_sync_result === "PASS";
  const maxed = String(rep.queue_stop_reason || "") === "queue_max_reached";
  const qc = Number(rep.queue_cycles_completed);
  const multiCycleNoSafe =
    String(rep.queue_stop_reason || "") === "no_safe_candidate" && Number.isFinite(qc) && qc > 1;
  return Boolean(mergeOk || syncOk || maxed || multiCycleNoSafe);
}

function writeDevReport(obj) {
  fs.writeFileSync(DEV_REPORT, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

function buildRunAgainSummary(ctx) {
  const rep = ctx.queueReport || {};
  const lines = [
    "=== SILVER_AUTO_DEV_QUEUE_SUMMARY ===",
    `main_commit=${ctx.mainCommit || ""}`,
    `queue_stop_reason=${String(rep.queue_stop_reason || "")}`,
    `queue_cycles_completed=${String(rep.queue_cycles_completed != null ? rep.queue_cycles_completed : "")}`,
    `apply_merge_result=${String(rep.apply_merge_result || "")}`,
    `apply_sync_result=${String(rep.apply_sync_result || "")}`,
    `apply_stopped_reason=${String(rep.apply_stopped_reason || "")}`,
    "next_action=RUN_AGAIN",
    "recommended_next_command=npm run silver-auto",
    "=== END_SILVER_AUTO_DEV_QUEUE_SUMMARY ===",
  ];
  return lines.join("\n");
}

function printRunCursorSummary(rep) {
  console.log("=== SILVER_AUTO_CURSOR_ADAPTER_V1_RUN_SUMMARY ===");
  console.log(`cursor_adapter_mode=${String(rep.cursor_adapter_mode || "")}`);
  console.log(`cursor_adapter_available=${String(rep.cursor_adapter_available || "")}`);
  console.log(`cursor_diagnostic_wsl_ready=${String(rep.cursor_diagnostic_wsl_ready || "")}`);
  console.log(`cursor_adapter_wsl_ubuntu=${String(rep.cursor_adapter_wsl_ubuntu || "")}`);
  console.log(`cursor_adapter_executed=${String(rep.cursor_adapter_executed || "")}`);
  console.log(`cursor_exit_code=${String(rep.cursor_exit_code || "")}`);
  console.log(`cursor_output_file=${String(rep.cursor_output_file || "")}`);
  console.log(`max_cycles=${String(rep.max_cycles || "")}`);
  console.log(`loop_mode=${String(rep.loop_mode || "")}`);
  console.log(`loop_max_cycles=${String(rep.loop_max_cycles || "")}`);
  console.log(`hard_safe_max_cycles=${String(rep.hard_safe_max_cycles || "")}`);
  console.log(`requested_max_cycles=${String(rep.requested_max_cycles || "")}`);
  console.log(`effective_max_cycles=${String(rep.effective_max_cycles || "")}`);
  console.log(`loop_guard_version=${String(rep.loop_guard_version || "")}`);
  console.log(`max_cycles_guard_result=${String(rep.max_cycles_guard_result || "")}`);
  console.log(`loop_cycles_completed=${String(rep.loop_cycles_completed || "")}`);
  console.log(`loop_stop_reason=${String(rep.loop_stop_reason || "")}`);
  console.log(`loop_safe_to_continue=${String(rep.loop_safe_to_continue || "")}`);
  console.log(`loop_completed=${String(rep.loop_completed || "")}`);
  console.log(`safe_to_continue=${String(rep.safe_to_continue || "")}`);
  console.log(`next_action_written=${String(rep.next_action_written || "")}`);
  if (rep.current_loop_cycle) {
    console.log(`current_loop_cycle=${String(rep.current_loop_cycle)}`);
  }
  if (rep.last_completed_cycle) {
    console.log(`last_completed_cycle=${String(rep.last_completed_cycle)}`);
  }
  if (rep.elapsed_ms_total) {
    console.log(`elapsed_ms_total=${String(rep.elapsed_ms_total)}`);
  }
  if (rep.cursor_call_duration_ms) {
    console.log(`cursor_call_duration_ms=${String(rep.cursor_call_duration_ms)}`);
  }
  if (rep.effective_timeout_seconds) {
    console.log(`effective_timeout_seconds=${String(rep.effective_timeout_seconds)}`);
  }
  if (rep.stop_reason_detail) {
    console.log(`stop_reason_detail=${String(rep.stop_reason_detail)}`);
  }
  if (rep.next_action_size_chars) {
    console.log(`next_action_size_chars=${String(rep.next_action_size_chars)}`);
  }
  if (rep.cursor_output_size_chars) {
    console.log(`cursor_output_size_chars=${String(rep.cursor_output_size_chars)}`);
  }
  if (rep.loop_timeout_git_clean) {
    console.log(`loop_timeout_git_clean=${String(rep.loop_timeout_git_clean)}`);
  }
  if (rep.cursor_adapter_stop_reason) {
    console.log(`cursor_adapter_stop_reason=${String(rep.cursor_adapter_stop_reason)}`);
  }
  if (rep.handoff_persistence_guard) {
    console.log(`handoff_persistence_guard=${String(rep.handoff_persistence_guard)}`);
  }
  if (rep.handoff_persistence_detail) {
    console.log(`handoff_persistence_detail=${String(rep.handoff_persistence_detail)}`);
  }
  console.log("=== END_SILVER_AUTO_CURSOR_ADAPTER_V1_RUN_SUMMARY ===");
}

function main() {
  const argvSlice = process.argv.slice(2);
  if (argvSlice.includes("--cli-loop-guard-selftest") || argvSlice.includes("--cli-cap3-selftest")) {
    process.exit(runCliLoopGuardSelftest() ? 0 : 1);
  }
  if (argvSlice.includes("--cli-cycle-plan-selftest")) {
    process.exit(runCyclePlanSelftest() ? 0 : 1);
  }
  if (argvSlice.includes("--cli-handoff-persistence-selftest")) {
    process.exit(runHandoffPersistenceSelftest() ? 0 : 1);
  }
  if (argvSlice.includes("--cli-runtime-artifact-selftest")) {
    process.exit(runRuntimeArtifactSelftest() ? 0 : 1);
  }
  if (argvSlice.includes("--cli-loop-runtime-dirty-selftest")) {
    process.exit(runLoopRuntimeDirtySelftest() ? 0 : 1);
  }
  if (argvSlice.includes("--cli-planner-cluster-preference-selftest")) {
    process.exit(runPlannerClusterPreferenceSelftest() ? 0 : 1);
  }
  const cli = parseSilverAutoCli(argvSlice);
  const startedAt = new Date().toISOString();

  if (cli.runCursor && cli.maxCyclesError) {
    const repOut = withCursorSchema(
      {
        generatedAt: startedAt,
        mode: "SILVER_AUTO_DEV",
        main_commit: gitHead(),
        git_status_clean: "NO",
        branch_name: gitBranch(),
        preflight_stop: cli.maxCyclesError,
        queue_executed: "NO",
        queue_cycles_completed: "",
        queue_stop_reason: "",
        queue_safe_to_continue: "",
        safe_pr_available: "NO",
        next_action_written: "NO",
        next_action_file: "SILVER_NEXT_ACTION.md",
        safe_to_continue: "NO",
        recommended_next_command: cli.loopMode
          ? `Use: npm run silver-auto -- --run-cursor --loop --max-cycles=1..${HARD_SAFE_MAX_CYCLES} (hard safe limit)`
          : "Use: npm run silver-auto -- --run-cursor --max-cycles=1 (single-run mode)",
        report_fields_added: "YES",
        max_cycles_arg: cli.maxCyclesRaw == null || cli.maxCyclesRaw === "" ? "default_implicit_1" : String(cli.maxCyclesRaw).trim(),
      },
      cli,
    );
    writeDevReport(repOut);
    console.error(`SILVER_AUTO_DEV_CLI_STOP: ${cli.maxCyclesError}`);
    process.exit(1);
  }

  let mainCommit = "";
  let gitCleanBefore = "NO";
  let gitCleanAfter = "NO";
  let queueExecuted = "NO";
  let queueCycles = "";
  let queueStop = "";
  let queueSafe = "";
  let safePr = "NO";
  let nextWritten = "NO";
  let safeToContinue = "NO";
  let recommended = "";
  let preflightFail = "";

  const porcelainStart = gitPorcelain();
  if (!porcelainStart.ok) {
    preflightFail = porcelainStart.err || "git_status_failed";
  } else if (!isStrictCleanPorcelain(porcelainStart.text)) {
    preflightFail = "WORKTREE_NOT_CLEAN";
  } else {
    gitCleanBefore = "YES";
  }

  const branch = gitBranch();
  if (!preflightFail && branch !== "main") {
    preflightFail = `BRANCH_NOT_MAIN:${branch || "EMPTY"}`;
  }

  if (!preflightFail && !npmAvailable()) {
    preflightFail = "NPM_NOT_AVAILABLE";
  }

  const nodeCheck = runCommand(process.execPath, ["-v"]);
  if (!preflightFail && !nodeCheck.ok) {
    preflightFail = "NODE_EXEC_FAILED";
  }

  const appDiff = gitDiffPathNonEmpty("assets/app.js");
  if (!preflightFail && (!appDiff.ok || appDiff.nonEmpty)) {
    preflightFail = "ASSETS_APP_JS_NOT_CLEAN";
  }

  mainCommit = gitHead();

  if (preflightFail) {
    const repOut = withCursorSchema(
      {
        generatedAt: startedAt,
        mode: "SILVER_AUTO_DEV",
        main_commit: mainCommit,
        git_status_clean: "NO",
        branch_name: branch,
        preflight_stop: preflightFail,
        queue_executed: "NO",
        queue_cycles_completed: "",
        queue_stop_reason: "",
        queue_safe_to_continue: "",
        safe_pr_available: "NO",
        next_action_written: "NO",
        next_action_file: "SILVER_NEXT_ACTION.md",
        safe_to_continue: "NO",
        recommended_next_command: "Fix preflight (clean main, npm/node, assets/app.js clean), then: npm run silver-auto",
        report_fields_added: "YES",
      },
      cli,
    );
    writeDevReport(repOut);
    console.error(`SILVER_AUTO_DEV_PREFLIGHT_STOP: ${preflightFail}`);
    process.exit(1);
  }

  const orch = runCommand(process.execPath, [ORCHESTRATOR_SCRIPT, "--apply-safe-queue", "--max=3"]);
  queueExecuted = "YES";

  const parsed = readJsonFile(ORCHESTRATOR_REPORT);
  let qrep = parsed.ok ? parsed.data : null;
  if (!parsed.ok) {
    const repOut = withCursorSchema(
      {
        generatedAt: new Date().toISOString(),
        mode: "SILVER_AUTO_DEV",
        main_commit: gitHead() || mainCommit,
        git_status_clean: isStrictCleanPorcelain(gitPorcelain().text || "") ? "YES" : "NO",
        branch_name: gitBranch(),
        queue_executed: queueExecuted,
        queue_cycles_completed: "",
        queue_stop_reason: "orchestrator_report_missing",
        queue_safe_to_continue: "NO",
        safe_pr_available: "NO",
        next_action_written: "NO",
        next_action_file: "SILVER_NEXT_ACTION.md",
        safe_to_continue: "NO",
        recommended_next_command: "node scripts/silver-pr-orchestrator-v1.cjs --dry-run",
        orchestrator_exit_code: orch.exitCode,
        orchestrator_ok: yn(orch.ok),
        orchestrator_report_error: parsed.message,
        report_fields_added: "YES",
      },
      cli,
    );
    writeDevReport(repOut);
    console.error(parsed.message || "orchestrator_report_read_failed");
    process.exit(1);
  }

  queueCycles = String(qrep.queue_cycles_completed != null ? qrep.queue_cycles_completed : "");
  queueStop = String(qrep.queue_stop_reason || "");
  queueSafe = String(qrep.queue_safe_to_continue || "");
  safePr = safePrAvailableFromQueue(qrep);
  mainCommit = String(qrep.main_commit || "").trim() || gitHead() || mainCommit;

  const didWork = queueDidMergeOrSync(qrep);
  const handoff = queueSafe === "YES" && queueStop === "no_safe_candidate" && !didWork;

  if (handoff) {
    const clusterDiag = pickTopClusterDiagnostic();
    const md = buildHandoffMarkdown({ mainCommit, queueReport: qrep, clusterDiag });
    fs.writeFileSync(NEXT_ACTION_FILE, md, "utf8");
    nextWritten = "YES";
    safeToContinue = "YES";
    recommended = "Open SILVER_NEXT_ACTION.md in Cursor and execute the scripted diagnostic task (no ChatGPT ping-pong).";
  } else if (didWork) {
    console.log(buildRunAgainSummary({ mainCommit, queueReport: qrep }));
    nextWritten = "NO";
    safeToContinue = "YES";
    recommended = "npm run silver-auto";
  } else {
    nextWritten = "NO";
    safeToContinue = queueSafe === "YES" ? "YES" : "NO";
    recommended =
      queueSafe === "YES"
        ? "node scripts/silver-pr-orchestrator-v1.cjs --dry-run"
        : "Investigate scripts/silver-pr-orchestrator-v1-report.json; fix blockers; then npm run silver-auto";
  }

  const porcelainEnd = gitPorcelain();
  gitCleanAfter = porcelainEnd.ok && isStrictCleanPorcelain(porcelainEnd.text) ? "YES" : "NO";

  const repOut = {
    generatedAt: new Date().toISOString(),
    mode: "SILVER_AUTO_DEV",
    main_commit: mainCommit,
    git_status_clean: gitCleanAfter,
    git_status_clean_before: gitCleanBefore,
    branch_name: gitBranch(),
    queue_executed: queueExecuted,
    queue_cycles_completed: queueCycles,
    queue_stop_reason: queueStop,
    queue_safe_to_continue: queueSafe,
    safe_pr_available: safePr,
    next_action_written: nextWritten,
    next_action_file: "SILVER_NEXT_ACTION.md",
    safe_to_continue: safeToContinue,
    recommended_next_command: recommended,
    orchestrator_exit_code: orch.exitCode,
    orchestrator_ok: yn(orch.ok),
    queue_did_merge_or_sync: yn(didWork),
    handoff_mode: handoff ? "PRODUCT_CLUSTER_DIAGNOSTIC" : didWork ? "RUN_AGAIN" : "NO_HANDOFF",
    report_fields_added: "YES",
  };

  if (cli.runCursor) {
    repOut.max_cycles_arg =
      cli.maxCyclesRaw == null || cli.maxCyclesRaw === ""
        ? cli.loopMode
          ? "required_for_loop"
          : "default_implicit_1"
        : String(cli.maxCyclesRaw).trim();
  }

  const needCursorHandoff = nextWritten === "YES" && fs.existsSync(NEXT_ACTION_FILE);

  if (cli.runCursor && orch.ok) {
    const adapter = discoverCursorAdapter();
    repOut.cursor_adapter_available = yn(adapter.ok);
    const wslReady = readWslCursorAdapterReadyFromDiagnostic();
    repOut.cursor_diagnostic_wsl_ready = wslReady;
    const useWslUbuntuAgent =
      process.platform === "win32" && adapter.ok && wslReady === "YES";
    if (!adapter.ok) {
      repOut.cursor_adapter_stop_reason = adapter.reason;
    }
    if (needCursorHandoff) {
      if (!adapter.ok) {
        repOut.safe_to_continue = "NO";
        repOut.recommended_next_command =
          "STOP: cursor adapter unavailable (" +
          String(adapter.reason || "unknown") +
          "). Fix scripts/silver-cursor-agent-adapter.ps1 / pwsh (non-Windows), then run scripts/silver-cursor-agent-adapter-diagnostic.ps1 until adapter_ready=YES.";
      } else if (cli.loopMode) {
        const loopTarget = parseInt(String(cli.maxCycles || "0"), 10);
        repOut.cursor_adapter_wsl_ubuntu = yn(useWslUbuntuAgent);
        repOut.loop_max_cycles = String(loopTarget);
        repOut.hard_safe_max_cycles = String(HARD_SAFE_MAX_CYCLES);
        repOut.requested_max_cycles = String(cli.maxCyclesRaw || "").trim() || String(loopTarget);
        repOut.effective_max_cycles = String(loopTarget);
        repOut.loop_long_run_tranche_size = String(LOOP_LONG_RUN_TRANCHE_SIZE);
        const loopHandoffCtx = {
          mainCommit,
          queueReport: qrep,
          clusterDiag: pickTopClusterDiagnostic(),
        };
        const preLoopRead = readSilverNextActionQuality();
        let preLoopRegenerated = "NO";
        if (preLoopRead.ok && preLoopRead.violations.length) {
          preLoopRegenerated = regenerateDeterministicClusterNextAction(loopHandoffCtx);
        }
        const preLoopNext = readSilverNextActionQuality();
        repOut.loop_next_action_precheck = preLoopNext.ok && preLoopNext.violations.length === 0 ? "PASS" : "FAIL";
        if (preLoopRead.violations.length) {
          repOut.loop_next_action_violations = preLoopRead.violations.join(",");
          repOut.loop_next_action_regenerated = preLoopRegenerated;
        }
        let completed = 0;
        let loopStopReason = "";
        let loopStopReasonDetail = "";
        let loopSafe = "YES";
        const loopStartedMs = Date.now();
        if (!preLoopNext.ok || preLoopNext.violations.length > 0) {
          loopStopReason = "NEXT_ACTION_GENERIC_NOT_CLUSTER_WORKFLOW";
          loopStopReasonDetail =
            "PRECHECK=" +
            (preLoopRead.violations.length ? preLoopRead.violations.join(",") : preLoopNext.violations.join(",")) +
            ";REGENERATED=" +
            preLoopRegenerated;
          loopSafe = "NO";
        }
        for (let cycle = 1; cycle <= loopTarget && loopSafe === "YES"; cycle += 1) {
          const cyclePlan = resolveLoopCycleAdapterPlan(loopTarget, cycle);
          const cycleStartedMs = Date.now();
          const cursorCallStartedAt = new Date().toISOString();
          const nextActionChars = readTextFileCharCount(NEXT_ACTION_FILE);
          const cursorOutputCharsBefore = readTextFileCharCount(CURSOR_OUTPUT_FILE);
          printLoopCycleHeartbeat({
            current_loop_cycle: String(cycle),
            last_completed_cycle: String(completed),
            loop_max_cycles: String(loopTarget),
            cycle_mode: cyclePlan.cycle_mode,
            elapsed_ms_total: String(Date.now() - loopStartedMs),
            elapsed_ms_current_cycle: "0",
            cursor_call_started_at: cursorCallStartedAt,
            cursor_call_finished_at: "",
            cursor_call_duration_ms: "",
            effective_timeout_seconds: String(cyclePlan.timeoutSeconds),
            next_action_size_chars: String(nextActionChars),
            cursor_output_size_chars: String(cursorOutputCharsBefore),
          });
          const ar = runSilverCursorAdapter(adapter, {
            useWslUbuntuAgent,
            useProbe: cyclePlan.useProbe,
            taskFile: cyclePlan.taskFile,
            timeoutSeconds: cyclePlan.timeoutSeconds,
          });
          const cursorCallFinishedAt = new Date().toISOString();
          const cursorCallDurationMs = Date.now() - cycleStartedMs;
          const adapterMeta = parseAdapterOutputMeta(
            fs.existsSync(CURSOR_OUTPUT_FILE) ? fs.readFileSync(CURSOR_OUTPUT_FILE, "utf8") : "",
          );
          repOut.current_loop_cycle = String(cycle);
          repOut.last_completed_cycle = String(completed);
          repOut.elapsed_ms_total = String(Date.now() - loopStartedMs);
          repOut.elapsed_ms_current_cycle = String(cursorCallDurationMs);
          repOut.cursor_call_started_at = cursorCallStartedAt;
          repOut.cursor_call_finished_at = cursorCallFinishedAt;
          repOut.cursor_call_duration_ms = String(cursorCallDurationMs);
          repOut.effective_timeout_seconds = String(cyclePlan.timeoutSeconds);
          repOut.next_action_size_chars = String(nextActionChars);
          repOut.cursor_output_size_chars = String(readTextFileCharCount(CURSOR_OUTPUT_FILE));
          repOut.loop_cycle_mode = cyclePlan.cycle_mode;
          repOut.cursor_adapter_executed = "YES";
          repOut.cursor_exit_code = String(ar.exitCode);
          if (!ar.ok || ar.exitCode !== 0) {
            loopStopReason = `CURSOR_EXIT_CODE_${String(ar.exitCode)}`;
            if (ar.exitCode === 124) {
              loopStopReasonDetail =
                "ADAPTER_WATCHDOG_TIMEOUT" +
                ";timed_out=" +
                String(adapterMeta.timed_out || "UNKNOWN") +
                ";elapsed_ms=" +
                String(adapterMeta.elapsed_ms || cursorCallDurationMs) +
                ";timeout_seconds=" +
                String(adapterMeta.timeout_seconds || cyclePlan.timeoutSeconds) +
                ";cycle_mode=" +
                cyclePlan.cycle_mode;
              const timeoutRuntime = evaluateLoopRuntimeSafety();
              repOut.loop_timeout_git_clean = timeoutRuntime.gitClean;
              repOut.loop_timeout_dirty_paths = timeoutRuntime.dirtyPaths.join(",");
              repOut.loop_timeout_outside_allowed = timeoutRuntime.outsideAllowed.join(",");
            } else {
              loopStopReasonDetail = "CURSOR_ADAPTER_NONZERO_EXIT;cycle_mode=" + cyclePlan.cycle_mode;
            }
            loopSafe = "NO";
            break;
          }
          if (String(repOut.safe_to_continue || "") !== "YES") {
            loopStopReason = "SAFE_TO_CONTINUE_NO";
            loopStopReasonDetail = "SAFE_TO_CONTINUE_NO_AFTER_CYCLE_" + String(cycle);
            loopSafe = "NO";
            break;
          }
          const runtime = evaluateLoopRuntimeSafety();
          if (!runtime.ok) {
            loopStopReason = runtime.reason || "RUNTIME_GIT_STATUS_FAILED";
            loopStopReasonDetail = "RUNTIME_GIT_STATUS_FAILED_AT_CYCLE_" + String(cycle);
            loopSafe = "NO";
            break;
          }
          if (runtime.outsideAllowed.length > 0) {
            loopStopReason = "RUNTIME_DIRTY_OUTSIDE_ALLOWED";
            loopStopReasonDetail =
              "OUTSIDE_ALLOWED=" + runtime.outsideAllowed.join(",") + ";AT_CYCLE_" + String(cycle);
            loopSafe = "NO";
            break;
          }
          if (cyclePlan.cycle_mode === "FULL_AGENT_HANDOFF") {
            const postRead = readSilverNextActionQuality();
            repOut.loop_next_action_post_cycle =
              postRead.ok && postRead.violations.length === 0 ? "PASS" : "FAIL";
            if (postRead.ok && postRead.violations.length > 0) {
              const regen = regenerateDeterministicClusterNextAction(loopHandoffCtx);
              loopStopReason = "NEXT_ACTION_GENERIC_NOT_CLUSTER_WORKFLOW";
              loopStopReasonDetail =
                "POST_CYCLE=" +
                postRead.violations.join(",") +
                ";REGENERATED=" +
                regen +
                ";AT_CYCLE_" +
                String(cycle);
              loopSafe = "NO";
              break;
            }
          }
          const appCycleDiff = gitDiffPathNonEmpty("assets/app.js");
          if (!appCycleDiff.ok || appCycleDiff.nonEmpty) {
            loopStopReason = "ASSETS_APP_JS_CHANGED";
            loopStopReasonDetail = "ASSETS_APP_JS_CHANGED_AT_CYCLE_" + String(cycle);
            loopSafe = "NO";
            break;
          }
          completed += 1;
          repOut.last_completed_cycle = String(completed);
        }
        repOut.loop_cycles_completed = String(completed);
        const handoffPersist = evaluateLoopHandoffPersistence(loopTarget, completed, loopSafe);
        if (!handoffPersist.ok) {
          loopStopReason = handoffPersist.stopReason;
          loopStopReasonDetail = handoffPersist.detail;
          loopSafe = "NO";
        }
        repOut.loop_stop_reason = loopStopReason || "LOOP_COMPLETED";
        repOut.stop_reason_detail = loopStopReasonDetail || "LOOP_COMPLETED_OK";
        repOut.loop_safe_to_continue = loopSafe;
        repOut.handoff_persistence_guard = handoffPersist.ok ? "PASS" : "FAIL";
        if (handoffPersist.detail) {
          repOut.handoff_persistence_detail = handoffPersist.detail;
        }
        if (completed === loopTarget && loopSafe === "YES") {
          repOut.loop_completed = "YES";
        } else {
          repOut.loop_completed = "NO";
          repOut.safe_to_continue = "NO";
          repOut.recommended_next_command =
            handoffPersist.ok
              ? "STOP: inspect SILVER_CURSOR_OUTPUT.md and runtime dirty paths; fix blocker, then rerun npm run silver-auto -- --run-cursor --loop --max-cycles=" +
                String(loopTarget)
              : "STOP: handoff persistence guard failed (" +
                String(handoffPersist.detail || handoffPersist.stopReason) +
                "); read SILVER_CURSOR_OUTPUT.md and SILVER_NEXT_ACTION.md; fix encoding/generic task; rerun npm run silver-auto -- --run-cursor --loop --max-cycles=" +
                String(loopTarget);
        }
      } else {
        if (needCursorHandoff) {
          enforceDeterministicClusterNextAction({
            mainCommit,
            queueReport: qrep,
            clusterDiag: pickTopClusterDiagnostic(),
          });
        }
        const singleTimeout = resolveSingleRunAdapterTimeoutSeconds(1);
        repOut.effective_timeout_seconds = String(singleTimeout);
        const ar = runSilverCursorAdapter(adapter, {
          useWslUbuntuAgent,
          timeoutSeconds: singleTimeout,
        });
        repOut.cursor_adapter_executed = "YES";
        repOut.cursor_exit_code = String(ar.exitCode);
        if (!ar.ok || ar.exitCode !== 0) {
          repOut.safe_to_continue = "NO";
          repOut.recommended_next_command =
            "Review SILVER_CURSOR_OUTPUT.md and scripts/silver-cursor-agent-adapter-diagnostic-report.json; fix adapter/Cursor CLI; then: npm run silver-auto -- --run-cursor --max-cycles=1";
        }
      }
    } else {
      repOut.cursor_adapter_executed = "NO";
      repOut.cursor_exit_code = "";
      if (cli.loopMode) {
        repOut.loop_cycles_completed = "0";
        repOut.loop_stop_reason = "NO_HANDOFF_FOR_LOOP";
        repOut.loop_safe_to_continue = "NO";
        repOut.loop_completed = "NO";
        repOut.safe_to_continue = "NO";
      }
    }
  }

  writeDevReport(withCursorSchema(repOut, cli));

  if (!orch.ok) {
    console.error(orch.message || `orchestrator_exit_${orch.exitCode}`);
    process.exit(1);
  }

  if (cli.runCursor) {
    printRunCursorSummary(withCursorSchema(repOut, cli));
    let exitCode = 0;
    if (needCursorHandoff && repOut.cursor_adapter_available === "NO") {
      exitCode = 1;
    } else if (cli.loopMode && repOut.loop_completed !== "YES") {
      exitCode = 1;
    } else if (repOut.cursor_adapter_executed === "YES" && String(repOut.cursor_exit_code) !== "0") {
      exitCode = 1;
    }
    restoreLoopRuntimeFiles();
    process.exit(exitCode);
  }

  process.exit(0);
}

try {
  main();
} catch (e) {
  const cli = parseSilverAutoCli(process.argv.slice(2));
  const msg = String((e && e.message) || e || "unexpected_error");
  writeDevReport(
    withCursorSchema(
      {
        generatedAt: new Date().toISOString(),
        mode: "SILVER_AUTO_DEV",
        main_commit: gitHead(),
        git_status_clean: "NO",
        queue_executed: "NO",
        queue_cycles_completed: "",
        queue_stop_reason: "silver_auto_dev_exception",
        safe_pr_available: "NO",
        next_action_written: "NO",
        next_action_file: "SILVER_NEXT_ACTION.md",
        safe_to_continue: "NO",
        recommended_next_command: "npm run silver-auto",
        error_message: msg,
        report_fields_added: "YES",
      },
      cli,
    ),
  );
  console.error(msg);
  process.exit(1);
}
