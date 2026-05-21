#!/usr/bin/env node
/**
 * Silver — Cursor 3 execution bridge diagnostics (orchestration only).
 * Detects cursor CLI vs legacy cursor-agent PATH, adapter lanes, runtime freshness.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const WINDOWS_WIN_LANE_REASONS = new Set([
  "help_lists_input_output",
  "headless_probe_marker_exit0_stdout",
  "stdin_pipe_marker_exit0_stdout",
]);

function readTextSafe(abs) {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

function readJsonSafe(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

function runGit(repoRoot, args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function gitClean(repoRoot) {
  try {
    const po = runGit(repoRoot, ["-c", "core.quotePath=false", "status", "--porcelain"]);
    return po === "";
  } catch {
    return false;
  }
}

function whereExe(name) {
  try {
    const out = execFileSync("where.exe", [name], {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^INFO:/i.test(l));
    return { exit: 0, lines, path: lines[0] || "" };
  } catch (e) {
    const stdout = e && e.stdout ? String(e.stdout) : "";
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^INFO:/i.test(l));
    if (lines.length > 0) return { exit: 0, lines, path: lines[0] || "" };
    const code = e && typeof e.status === "number" ? e.status : 1;
    return { exit: code, lines: [], path: "" };
  }
}

function selectCursorCmdPath(lines) {
  for (const ln of lines) {
    if (/cursor\.cmd$/i.test(ln)) return ln;
  }
  for (const ln of lines) {
    if (/[\\/]bin[\\/]cursor$/i.test(ln)) return ln;
  }
  return lines[0] || "";
}

function probeCursorVersion(_cursorPath, repoRoot) {
  try {
    const v =
      process.platform === "win32"
        ? execFileSync("cmd.exe", ["/c", "cursor --version"], {
            cwd: repoRoot,
            encoding: "utf8",
            timeout: 60000,
            windowsHide: true,
          })
        : execFileSync("cursor", ["--version"], {
            cwd: repoRoot,
            encoding: "utf8",
            timeout: 60000,
            windowsHide: true,
          });
    return { exit: 0, version: String(v || "").trim() };
  } catch (e) {
    const stdout = e && e.stdout ? String(e.stdout) : "";
    const stderr = e && e.stderr ? String(e.stderr) : "";
    return { exit: typeof e.status === "number" ? e.status : 1, version: (stdout + stderr).trim() };
  }
}

function probeCursorHelpHeadline(repoRoot) {
  try {
    const h =
      process.platform === "win32"
        ? execFileSync("cmd.exe", ["/c", "cursor --help"], {
            cwd: repoRoot,
            encoding: "utf8",
            timeout: 60000,
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024,
          })
        : execFileSync("cursor", ["--help"], {
            cwd: repoRoot,
            encoding: "utf8",
            timeout: 60000,
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024,
          });
    return String(h || "").split(/\r?\n/)[0].trim();
  } catch {
    return "";
  }
}

function parseCursorMajor(versionText) {
  const first = String(versionText || "").split(/\|/)[0].split(/\r?\n/)[0].trim();
  const m = first.match(/^Cursor\s+(\d+)/i) || first.match(/^(\d+)\./);
  return m ? m[1] : "";
}

function detectCursor3(versionText) {
  const t = String(versionText || "").trim();
  if (!t) return false;
  const first = t.split(/\r?\n/)[0].trim();
  if (/^Cursor\s+3\b/i.test(first)) return true;
  if (/^3\.\d+/.test(first)) return true;
  const m = first.match(/^(\d+)\./);
  if (m && parseInt(m[1], 10) >= 3) return true;
  if (/\bCursor\s+3\./i.test(t)) return true;
  return false;
}

function parseAdapterMeta(text) {
  const out = {};
  const full = String(text || "");
  if (full.indexOf("# silver-cursor-agent-adapter") < 0) return out;
  const idx = full.indexOf("# stdout");
  const head = idx >= 0 ? full.slice(0, idx) : full;
  for (const raw of head.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    if (!/^[a-zA-Z0-9_]+$/.test(k)) continue;
    out[k] = line.slice(eq + 1);
  }
  return out;
}

function evaluateRuntimeFreshness(cursorText, repoRoot) {
  const meta = parseAdapterMeta(cursorText);
  const state = String(meta.adapter_output_state || "").trim();
  if (state === "INVOKE_STARTED") {
    return { fresh: "NO", hint: "adapter_invoke_in_progress" };
  }
  if (state === "INVALIDATED_AWAITING_CYCLE") {
    return { fresh: "NO", hint: "invalidated_awaiting_cycle" };
  }
  const runId = String(process.env.SILVER_AUTONOMOUS_RUN_ID || "").trim();
  if (runId) {
    const metaRun = String(meta.autonomous_run_id || "").trim();
    if (metaRun && metaRun !== runId) {
      return { fresh: "NO", hint: "autonomous_run_identity_mismatch" };
    }
  }
  const completed = state === "COMPLETED" || state === "COMPLETE";
  if (completed) {
    const exitCode = String(meta.exit_code || "").trim();
    if (exitCode && exitCode !== "0") {
      return { fresh: "YES", hint: "last_completed_nonzero_exit" };
    }
    return { fresh: "YES", hint: "completed_capture_ok" };
  }
  if (!state && cursorText.trim().length < 20) {
    return { fresh: "YES", hint: "empty_or_minimal_cursor_output" };
  }
  if (state) {
    return { fresh: "NO", hint: "adapter_state_not_terminal:" + state };
  }
  const reportMtime = fileAgeMs(path.join(repoRoot, "SILVER_RUN_REPORT.md"));
  const progressMtime = fileAgeMs(path.join(repoRoot, "SILVER_PROGRESS_LOG.md"));
  const cursorMtime = fileAgeMs(path.join(repoRoot, "SILVER_CURSOR_OUTPUT.md"));
  if (cursorMtime > 0 && reportMtime > 0 && cursorMtime + 6 * 3600 * 1000 < reportMtime) {
    return { fresh: "NO", hint: "cursor_output_older_than_run_report" };
  }
  if (progressMtime > 0 && cursorMtime > 0 && progressMtime > cursorMtime + 2 * 3600 * 1000) {
    const tail = readTextSafe(path.join(repoRoot, "SILVER_PROGRESS_LOG.md")).slice(-4000);
    if (/silver_cycle_.*cursor_exit=124/i.test(tail)) {
      return { fresh: "NO", hint: "progress_log_timeout_after_stale_cursor" };
    }
  }
  return { fresh: "YES", hint: "no_blocking_stale_signal" };
}

function fileAgeMs(abs) {
  try {
    return fs.statSync(abs).mtimeMs;
  } catch {
    return 0;
  }
}

function readDiagnosticLanes(repoRoot) {
  const diagPath = path.join(repoRoot, "scripts", "silver-cursor-agent-adapter-diagnostic-report.json");
  const j = readJsonSafe(diagPath);
  if (!j) {
    return {
      diag_present: "NO",
      windows_lane_ready: "NO",
      wsl_lane_ready: "NO",
      adapter_ready: "UNKNOWN",
      adapter_ready_reason: "",
      preferred_headless: "NO",
      preferred_stdin: "NO",
      diagnostic_cursor_major: "",
      recommended_full_loop: "",
    };
  }
  const reason = String(j.adapter_ready_reason || "").trim();
  const windowsLane =
    WINDOWS_WIN_LANE_REASONS.has(reason) ||
    (Array.isArray(j.preferred_headless_argv) && j.preferred_headless_argv.length >= 2) ||
    (Array.isArray(j.preferred_stdin_argv) &&
      j.preferred_stdin_argv.length >= 1 &&
      String(j.preferred_invocation_kind || "") === "stdin_pipe");
  const wslPack = j.wsl_cursor_agent_print_ask_trust || {};
  const wslLane = String(wslPack.adapter_ready || "").toUpperCase() === "YES";
  const ver = String(j.cursor_version || "").split(/\r?\n/)[0].trim();
  const major = (ver.match(/^Cursor\s+(\d+)/i) || ver.match(/^(\d+)\./) || [])[1] || "";
  return {
    diag_present: "YES",
    windows_lane_ready: windowsLane ? "YES" : "NO",
    wsl_lane_ready: wslLane ? "YES" : "NO",
    adapter_ready: String(j.adapter_ready || "UNKNOWN").toUpperCase(),
    adapter_ready_reason: reason,
    preferred_headless: Array.isArray(j.preferred_headless_argv) && j.preferred_headless_argv.length >= 2 ? "YES" : "NO",
    preferred_stdin: String(j.preferred_invocation_kind || "") === "stdin_pipe" ? "YES" : "NO",
    diagnostic_cursor_major: major,
    recommended_full_loop: String(j.recommended_cursor_command_full_loop || ""),
  };
}

function deriveCurrentState(cursorText, runtimeFresh) {
  const meta = parseAdapterMeta(cursorText);
  const state = String(meta.adapter_output_state || "").trim();
  if (state === "INVOKE_STARTED") return "RUNNING";
  if (runtimeFresh.fresh === "NO") {
    if (/invoke_in_progress|invalidated|mismatch/i.test(runtimeFresh.hint)) return "STALE";
    if (/timeout|not_terminal/i.test(runtimeFresh.hint)) return "STALE";
    return "STALE";
  }
  if (state === "COMPLETED" || state === "COMPLETE") {
    const exitCode = String(meta.exit_code || "").trim();
    if (exitCode && exitCode !== "0") return "FAILED";
    return "STOPPED";
  }
  return "SAFE_TO_START";
}

function collectCursor3ExecutionStatus(repoRoot) {
  const root = path.resolve(repoRoot || path.join(__dirname, ".."));
  const cursorWhere = whereExe("cursor");
  const agentWhere = whereExe("cursor-agent");
  const cursorCliAvailable = cursorWhere.lines.length > 0 ? "YES" : "NO";
  const cursorAgentAvailable = agentWhere.lines.length > 0 ? "YES" : "NO";
  const cursorCliPath = selectCursorCmdPath(cursorWhere.lines);
  const verProbe = probeCursorVersion(cursorCliPath, root);
  let cursorCliVersion = verProbe.version;
  if (!detectCursor3(cursorCliVersion)) {
    const helpHead = probeCursorHelpHeadline(root);
    if (helpHead) {
      cursorCliVersion = (cursorCliVersion ? cursorCliVersion + " | " : "") + "help:" + helpHead;
    }
  }
  const cursor3Detected =
    detectCursor3(cursorCliVersion) || /Cursor\s+3\./i.test(probeCursorHelpHeadline(root)) ? "YES" : "NO";
  const lanes = readDiagnosticLanes(root);
  const adapterScript = path.join(root, "scripts", "silver-cursor-agent-adapter.ps1");
  const adapterExists = fs.existsSync(adapterScript);
  const legacyAdapterUsable =
    adapterExists &&
    lanes.diag_present === "YES" &&
    lanes.adapter_ready === "YES" &&
    (lanes.windows_lane_ready === "YES" || lanes.wsl_lane_ready === "YES")
      ? "YES"
      : "NO";
  const powershellBridgeUsable =
    cursorCliAvailable === "YES" && legacyAdapterUsable === "YES" ? "YES" : "NO";
  const liveMajor = parseCursorMajor(cursorCliVersion);
  const diagStale =
    lanes.diag_present === "YES" &&
    lanes.diagnostic_cursor_major &&
    liveMajor &&
    lanes.diagnostic_cursor_major !== liveMajor
      ? "YES"
      : "NO";
  const cursorText = readTextSafe(path.join(root, "SILVER_CURSOR_OUTPUT.md"));
  const runtimeFresh = evaluateRuntimeFreshness(cursorText, root);
  const silverRuntimeFilesFresh = runtimeFresh.fresh;
  const clean = gitClean(root);
  const currentState = deriveCurrentState(cursorText, runtimeFresh);
  let executionBridgeStatus = "FAIL";
  let reason = "";
  if (cursorCliAvailable !== "YES") {
    executionBridgeStatus = "FAIL";
    reason = "cursor_cli_not_on_path";
  } else if (cursorAgentAvailable === "YES") {
    executionBridgeStatus = "LEGACY_AGENT_PATH";
    reason = "cursor_agent_standalone_on_path_use_cursor_agent_subcommand";
  } else if (powershellBridgeUsable !== "YES") {
    executionBridgeStatus = "CURSOR3_EXECUTION_BRIDGE_UNAVAILABLE";
    if (cursor3Detected === "YES" && lanes.wsl_lane_ready === "NO" && lanes.windows_lane_ready === "NO") {
      reason =
        "cursor3_windows_headless_unavailable_no_wsl_lane;run scripts/silver-cursor-agent-adapter-diagnostic.ps1 or manual Cursor UI";
    } else if (lanes.diag_present !== "YES") {
      reason = "missing_adapter_diagnostic_json;run scripts/silver-cursor-agent-adapter-diagnostic.ps1";
    } else if (lanes.adapter_ready !== "YES") {
      reason = "adapter_diagnostic_not_ready";
    } else {
      reason = "no_usable_windows_or_wsl_adapter_lane";
    }
  } else if (currentState === "RUNNING") {
    executionBridgeStatus = "RUNNING";
    reason = "adapter_invoke_in_progress";
  } else if (currentState === "STALE") {
    executionBridgeStatus = "STALE";
    reason = runtimeFresh.hint;
  } else if (diagStale === "YES") {
    executionBridgeStatus = "STALE_DIAGNOSTIC";
    reason = "diagnostic_cursor_version_major_mismatch_refresh_diagnostic";
  } else {
    executionBridgeStatus = "PASS";
    reason = lanes.wsl_lane_ready === "YES" ? "wsl_agent_lane_ready" : "windows_cursor_lane_ready";
  }
  const safeToStartBool =
    clean &&
    powershellBridgeUsable === "YES" &&
    silverRuntimeFilesFresh === "YES" &&
    executionBridgeStatus === "PASS" &&
    (currentState === "STOPPED" || currentState === "SAFE_TO_START");
  const safeToStart = safeToStartBool ? "YES" : "NO";
  if (safeToStart === "NO" && executionBridgeStatus === "PASS" && reason.indexOf("ready") >= 0) {
    if (!clean) reason = "repo_not_clean";
    else if (silverRuntimeFilesFresh !== "YES") reason = runtimeFresh.hint;
    else if (currentState === "RUNNING") reason = "adapter_running";
    else if (currentState === "FAILED") reason = "last_adapter_failed";
  }
  return {
    cursor_cli_available: cursorCliAvailable,
    cursor_cli_path: cursorCliPath,
    cursor_cli_version: cursorCliVersion.replace(/\r?\n/g, " | "),
    cursor_agent_available: cursorAgentAvailable,
    cursor_agent_path: agentWhere.path,
    legacy_adapter_usable: legacyAdapterUsable,
    cursor3_detected: cursor3Detected,
    powershell_execution_bridge_usable: powershellBridgeUsable,
    silver_runtime_files_fresh: silverRuntimeFilesFresh,
    repo_git_clean: clean ? "YES" : "NO",
    current_state: currentState,
    safe_to_start_controlled_cap10: safeToStart,
    execution_bridge_status: executionBridgeStatus,
    reason,
    windows_lane_ready: lanes.windows_lane_ready,
    wsl_lane_ready: lanes.wsl_lane_ready,
    diagnostic_present: lanes.diag_present,
    diagnostic_stale_major: diagStale,
    runtime_fresh_hint: runtimeFresh.hint,
    recommended_cursor_command_full_loop: lanes.recommended_full_loop,
  };
}

function printCursor3ExecutionStatus(repoRoot) {
  const s = collectCursor3ExecutionStatus(repoRoot);
  console.log("=== CURSOR3_EXECUTION_STATUS ===");
  for (const k of [
    "cursor_cli_available",
    "cursor_cli_path",
    "cursor_cli_version",
    "cursor_agent_available",
    "cursor_agent_path",
    "legacy_adapter_usable",
    "cursor3_detected",
    "powershell_execution_bridge_usable",
    "silver_runtime_files_fresh",
    "repo_git_clean",
    "current_state",
    "safe_to_start_controlled_cap10",
    "execution_bridge_status",
    "reason",
    "windows_lane_ready",
    "wsl_lane_ready",
    "diagnostic_present",
    "diagnostic_stale_major",
    "runtime_fresh_hint",
  ]) {
    console.log(k + "=" + String(s[k] ?? ""));
  }
  console.log("PASS_FAIL=" + (s.execution_bridge_status === "PASS" ? "PASS" : "FAIL"));
  console.log("=== END_CURSOR3_EXECUTION_STATUS ===");
  return s.execution_bridge_status === "PASS" ? 0 : 1;
}

function runCursor3ExecutionBridgeSelftest(repoRoot) {
  const failures = [];
  const root = path.resolve(repoRoot || path.join(__dirname, ".."));
  const s = collectCursor3ExecutionStatus(root);

  if (s.cursor_cli_available !== "YES") failures.push("cursor_cli_available_expected_YES");
  if (s.cursor_agent_available !== "NO") failures.push("cursor_agent_available_expected_NO");
  if (s.cursor3_detected !== "YES") failures.push("cursor3_detected_expected_YES");
  if (!fs.existsSync(path.join(root, "scripts", "silver-cursor-agent-adapter.ps1"))) {
    failures.push("adapter_script_missing");
  }

  const stubStale =
    "# silver-cursor-agent-adapter\nadapter_output_state=INVALIDATED_AWAITING_CYCLE\n# stdout\n\n";
  const freshEval = evaluateRuntimeFreshness(stubStale, root);
  if (freshEval.fresh !== "NO") failures.push("stale_invalidated_expected_NO_fresh");

  const stubRunning = "# silver-cursor-agent-adapter\nadapter_output_state=INVOKE_STARTED\n# stdout\n\n";
  const runEval = evaluateRuntimeFreshness(stubRunning, root);
  if (runEval.fresh !== "NO") failures.push("running_invoke_expected_NO_fresh");

  if (s.legacy_adapter_usable === "YES") {
    const dryOut = path.join(require("os").tmpdir(), "silver-c3-bridge-dry-" + Date.now() + ".md");
    try {
      const r = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(root, "scripts", "silver-cursor-agent-adapter.ps1"),
          "-WslUbuntuAgent",
          "-DryRun",
          "-OutputFile",
          dryOut,
        ],
        { cwd: root, encoding: "utf8", timeout: 90000, windowsHide: true },
      );
      if (r.status !== 0) failures.push("adapter_wsl_dryrun_exit_" + String(r.status));
      if (!String(r.stdout || "").includes("END_SILVER_CURSOR_AGENT_ADAPTER_DRY_RUN")) {
        failures.push("adapter_wsl_dryrun_missing_banner");
      }
    } catch (e) {
      failures.push("adapter_wsl_dryrun_exception:" + String(e.message || e));
    } finally {
      try {
        fs.unlinkSync(dryOut);
      } catch {
        /* ignore */
      }
    }
  } else {
    const winDry = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(root, "scripts", "silver-cursor-agent-adapter.ps1"),
        "-Probe",
        "-OutputFile",
        path.join(require("os").tmpdir(), "silver-c3-win-probe.md"),
      ],
      { cwd: root, encoding: "utf8", timeout: 45000, windowsHide: true },
    );
    if (winDry.status === 0) failures.push("windows_probe_should_fail_when_no_windows_lane");
  }

  const dirty = [];
  try {
    const po = runGit(root, ["-c", "core.quotePath=false", "status", "--porcelain"]);
    for (const line of po.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      let rel = t;
      if (t.startsWith("?? ")) rel = t.slice(3).trim();
      else if (t.length >= 3 && t.charAt(2) === " ") rel = t.slice(3).trim();
      else {
        const sp = t.indexOf(" ");
        if (sp >= 0) rel = t.slice(sp + 1).trim();
      }
      if (
        /^scripts\/silver-cursor3-execution\.cjs$/i.test(rel) ||
        /^scripts\/silver-autopilot\.cjs$/i.test(rel) ||
        /^scripts\/silver-autopilot-loop\.ps1$/i.test(rel) ||
        /^scripts\/silver-cursor-agent-adapter/i.test(rel)
      ) {
        continue;
      }
      dirty.push(rel);
    }
  } catch {
    dirty.push("DIRTY_UNKNOWN");
  }
  if (dirty.length) failures.push("repo_unexpected_dirty:" + dirty.join(","));

  const pass = failures.length === 0;
  console.log("=== SILVER_CURSOR3_EXECUTION_BRIDGE_SELFTEST ===");
  console.log("PASS_FAIL=" + (pass ? "PASS" : "FAIL"));
  for (const f of failures) console.log("FAIL=" + f);
  console.log("cursor_cli_available=" + s.cursor_cli_available);
  console.log("cursor_agent_available=" + s.cursor_agent_available);
  console.log("cursor3_detected=" + s.cursor3_detected);
  console.log("legacy_adapter_usable=" + s.legacy_adapter_usable);
  console.log("powershell_execution_bridge_usable=" + s.powershell_execution_bridge_usable);
  console.log("=== END_SILVER_CURSOR3_EXECUTION_BRIDGE_SELFTEST ===");
  return pass;
}

module.exports = {
  collectCursor3ExecutionStatus,
  printCursor3ExecutionStatus,
  runCursor3ExecutionBridgeSelftest,
  evaluateRuntimeFreshness,
  detectCursor3,
};

if (require.main === module) {
  const cmd = process.argv[2];
  const repo = process.argv[3] || path.join(__dirname, "..");
  if (cmd === "--selftest") {
    process.exit(runCursor3ExecutionBridgeSelftest(repo) ? 0 : 1);
  }
  if (cmd === "--json") {
    const s = collectCursor3ExecutionStatus(repo);
    process.stdout.write(JSON.stringify(s) + "\n");
    process.exit(s.execution_bridge_status === "PASS" ? 0 : 1);
  }
  process.exit(printCursor3ExecutionStatus(repo));
}
