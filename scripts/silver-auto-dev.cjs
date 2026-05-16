#!/usr/bin/env node
/**
 * Silver Auto-Dev V1 — single-pass entrypoint: bounded safe PR queue, then deterministic
 * SILVER_NEXT_ACTION.md handoff when no ultra-safe PR candidate remains.
 * Optional `--run-cursor` (V1): after handoff, invokes `scripts/silver-cursor-agent-adapter.ps1`
 * once (max_cycles=1 only) — no outer loop. Does not modify assets/app.js or Silver engine.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

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
const RHC3_REPORT = path.join(__dirname, "silver-real-human-chaos-v3-report.json");
const REALISTIC_MOBILE_REPORT = path.join(__dirname, "silver-realistic-mobile-corpus-report.json");

const MAX_BUFFER = 64 * 1024 * 1024;
const LOOP_MAX_ALLOWED = new Set([1, 2, 3, 4, 5]);
const LOOP_RUNTIME_ALLOWED_DIRTY_PATHS = new Set([
  "SILVER_CURSOR_OUTPUT.md",
  "SILVER_NEXT_ACTION.md",
  "SILVER_RUN_REPORT.md",
  "scripts/silver-auto-dev-report.json",
  "scripts/silver-pr-orchestrator-v1-report.json",
  "scripts/silver-cursor-agent-adapter-diagnostic-report.json",
]);

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
  const outsideAllowed = dirtyPaths.filter((x) => !LOOP_RUNTIME_ALLOWED_DIRTY_PATHS.has(x));
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

function parseTopFailClustersFromReport(data) {
  if (!data || typeof data !== "object") return [];
  const arr = data.top_fail_clusters;
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const row of arr) {
    const s = String(row);
    const idx = s.lastIndexOf(":");
    if (idx <= 0) continue;
    const name = s.slice(0, idx).trim();
    const count = parseInt(s.slice(idx + 1), 10);
    if (!name || !Number.isFinite(count) || count <= 0) continue;
    out.push({ name, count });
  }
  return out;
}

function pickTopClusterDiagnostic() {
  const rhc3 = readJsonFile(RHC3_REPORT);
  if (rhc3.ok && rhc3.data) {
    const tops = parseTopFailClustersFromReport(rhc3.data);
    if (tops.length) {
      const t = tops[0];
      return {
        source: "scripts/silver-real-human-chaos-v3-report.json",
        cluster: t.name,
        count: t.count,
        top_preview: tops.slice(0, 8).map((x) => `${x.name}:${x.count}`).join(" | "),
      };
    }
  }
  const mob = readJsonFile(REALISTIC_MOBILE_REPORT);
  if (mob.ok && mob.data) {
    const tops = parseTopFailClustersFromReport(mob.data);
    if (tops.length) {
      const t = tops[0];
      return {
        source: "scripts/silver-realistic-mobile-corpus-report.json",
        cluster: t.name,
        count: t.count,
        top_preview: tops.slice(0, 8).map((x) => `${x.name}:${x.count}`).join(" | "),
      };
    }
    const fc = mob.data.fail_count_by_cluster;
    if (fc && typeof fc === "object") {
      const pairs = Object.keys(fc)
        .map((k) => ({ name: k, count: Number(fc[k]) }))
        .filter((p) => p.name && Number.isFinite(p.count) && p.count > 0)
        .sort((a, b) => b.count - a.count);
      if (pairs.length) {
        const t = pairs[0];
        return {
          source: "scripts/silver-realistic-mobile-corpus-report.json:fail_count_by_cluster",
          cluster: t.name,
          count: t.count,
          top_preview: pairs.slice(0, 8).map((x) => `${x.name}:${x.count}`).join(" | "),
        };
      }
    }
  }
  return {
    source: "(no_cluster_report)",
    cluster: "(unknown)",
    count: 0,
    top_preview: "(no nonzero fail clusters found on disk — run harnesses if needed)",
  };
}

function yn(b) {
  return b ? "YES" : "NO";
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
      } else if (!LOOP_MAX_ALLOWED.has(n)) {
        maxCyclesError = "LOOP_MAX_CYCLES_ALLOWED_1_TO_5";
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
      } else if (n !== 1) {
        maxCyclesError = "MAX_CYCLES_V1_ONLY_1";
      } else {
        maxCycles = "1";
      }
    }
  }
  return { runCursor, loopMode, maxCycles, maxCyclesError, maxCyclesRaw };
}

function cursorSchemaDefaults(cli) {
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

function runSilverCursorAdapter(adapter, opts) {
  const useWsl = Boolean(opts && opts.useWslUbuntuAgent);
  const args = [...adapter.fileArgs];
  if (useWsl) {
    args.push("-WslUbuntuAgent");
    const wslWs = repoRootWindowsToWslMnt(REPO);
    if (wslWs) {
      args.push("-WslWorkspaceLinuxPath", wslWs);
    }
  }
  args.push(
    "-TaskFile",
    "SILVER_NEXT_ACTION.md",
    "-OutputFile",
    "SILVER_CURSOR_OUTPUT.md",
    "-TimeoutSeconds",
    "3200",
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

function buildQueueSummaryLines(rep) {
  if (!rep || typeof rep !== "object") return "(no orchestrator report)";
  const lines = [
    `- mode: ${String(rep.mode || "")}`,
    `- queue_safe_to_continue: ${String(rep.queue_safe_to_continue || rep.safe_to_continue || "")}`,
    `- queue_stop_reason: ${String(rep.queue_stop_reason || "")}`,
    `- queue_cycles_completed: ${String(rep.queue_cycles_completed != null ? rep.queue_cycles_completed : "")}`,
    `- apply_stopped_reason: ${String(rep.apply_stopped_reason || "")}`,
    `- apply_merge_attempted/result: ${String(rep.apply_merge_attempted || "")}/${String(rep.apply_merge_result || "")}`,
    `- apply_sync_attempted/result: ${String(rep.apply_sync_attempted || "")}/${String(rep.apply_sync_result || "")}`,
    `- safe_open_candidates: ${String(rep.safe_open_candidates != null ? rep.safe_open_candidates : "")}`,
    `- total_open_prs: ${String(rep.total_open_prs != null ? rep.total_open_prs : "")}`,
    `- error: ${String(rep.error || "")}`,
  ];
  return lines.join("\n");
}

function writeDevReport(obj) {
  fs.writeFileSync(DEV_REPORT, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

function buildHandoffMarkdown(ctx) {
  const diag = ctx.clusterDiag || pickTopClusterDiagnostic();
  const qrep = ctx.queueReport || {};
  const main = ctx.mainCommit || "";
  return [
    "<!-- SILVER_NEXT_ACTION: silver-auto-dev V1 deterministic handoff; not auto-applied -->",
    "",
    "ÚKOL PRO CURSOR — infoUzel.cz / Silver — NEXT PRODUCT CLUSTER DIAGNOSTIC — NO ENGINE CHANGE + FINAL BEEP",
    "",
    "### Kontext (automaticky)",
    "",
    `- **Aktuální main commit:** \`${main}\``,
    "- **PR orchestrátor (poslední běh):** viz shrnutí níže + `scripts/silver-pr-orchestrator-v1-report.json`.",
    "",
    "### Shrnutí fronty safe PR",
    "",
    "```text",
    buildQueueSummaryLines(qrep),
    "```",
    "",
    "### Stav bezpečnosti / scope",
    "",
    "- **Zakázáno:** měnit `assets/app.js`, Silver engine (jádro), UI/CSS/backend jen kvůli diagnostice, GitHub workflows, nekonečné smyčky, surové `-MaxCycles 0` bez řízených pojistek z dokumentace.",
    "- **Povoleno:** skripty pod `scripts/`, audity/diagnostika existujících harnessů, čtení reportů JSON/MD, změny striktně mimo engine dle existující strategie.",
    "",
    "### Diagnostika top clusteru (disk)",
    "",
    `- **Zdroj:** ${diag.source}`,
    `- **Top cluster:** \`${diag.cluster}\` (count=${diag.count})`,
    `- **Náhled top:** ${diag.top_preview}`,
    "",
    "### Kroky (max 7)",
    "",
    "1) `Set-Location C:\\\\projects\\\\filtr`",
    "2) `git status --short` — nesmí být neočekávané změny mimo výslovně povolené reporting soubory.",
    "3) `node scripts/silver-autopilot.cjs --status` — ověř safety/gate signály v konzoli a `SILVER_RUN_REPORT.md`.",
    `4) Zaměř se na cluster **${diag.cluster}**: spusť existující diagnostické skripty pro tento typ selhání (vyber z manifestu v README autopilota / existujících \`silver-*\` harnessů; nevymýšlej nové cesty).`,
    "5) Pokud reporty JSON ukazují **harness-only** signály vs **true engine fail**, drž se pravidla: nejdřív důkaz z harness JSON (`true_engine_fail_count`, `must_fix_engine_count`, …).",
    "6) `npm run smoke` po jakékoli smysluplné změně skriptů (ne u čistého read-only průzkumu).",
    "7) Výstup vlož do chatu dle bloku níže.",
    "",
    "### Povinný výstup (vlož do chatu)",
    "",
    "```text",
    "=== SILVER_PRODUCT_CLUSTER_DIAGNOSTIC_RESULT ===",
    `main_commit=${main}`,
    `top_cluster=${diag.cluster}`,
    `cluster_source=${diag.source}`,
    "engine_touched=NO",
    "assets_app_touched=NO",
    "harness_next_command=(vyplň přesný příkaz, který jsi spustil)",
    "PASS_FAIL=(PASS|FAIL)",
    "=== END_SILVER_PRODUCT_CLUSTER_DIAGNOSTIC_RESULT ===",
    "```",
    "",
    "### FINISH",
    "",
    "Na konci lokálního ověření v PowerShell:",
    "",
    "```powershell",
    "[console]::beep(880, 200)",
    "```",
    "",
  ].join("\n");
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
  console.log(`loop_cycles_completed=${String(rep.loop_cycles_completed || "")}`);
  console.log(`loop_stop_reason=${String(rep.loop_stop_reason || "")}`);
  console.log(`loop_safe_to_continue=${String(rep.loop_safe_to_continue || "")}`);
  console.log(`loop_completed=${String(rep.loop_completed || "")}`);
  console.log(`safe_to_continue=${String(rep.safe_to_continue || "")}`);
  console.log(`next_action_written=${String(rep.next_action_written || "")}`);
  if (rep.cursor_adapter_stop_reason) {
    console.log(`cursor_adapter_stop_reason=${String(rep.cursor_adapter_stop_reason)}`);
  }
  console.log("=== END_SILVER_AUTO_CURSOR_ADAPTER_V1_RUN_SUMMARY ===");
}

function main() {
  const cli = parseSilverAutoCli(process.argv.slice(2));
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
          ? "Use: npm run silver-auto -- --run-cursor --loop --max-cycles=1..5"
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
        let completed = 0;
        let loopStopReason = "";
        let loopSafe = "YES";
        for (let cycle = 1; cycle <= loopTarget; cycle += 1) {
          const ar = runSilverCursorAdapter(adapter, { useWslUbuntuAgent });
          repOut.cursor_adapter_executed = "YES";
          repOut.cursor_exit_code = String(ar.exitCode);
          if (!ar.ok || ar.exitCode !== 0) {
            loopStopReason = `CURSOR_EXIT_CODE_${String(ar.exitCode)}`;
            loopSafe = "NO";
            break;
          }
          if (String(repOut.safe_to_continue || "") !== "YES") {
            loopStopReason = "SAFE_TO_CONTINUE_NO";
            loopSafe = "NO";
            break;
          }
          const runtime = evaluateLoopRuntimeSafety();
          if (!runtime.ok) {
            loopStopReason = runtime.reason || "RUNTIME_GIT_STATUS_FAILED";
            loopSafe = "NO";
            break;
          }
          if (runtime.outsideAllowed.length > 0) {
            loopStopReason = "RUNTIME_DIRTY_OUTSIDE_ALLOWED";
            loopSafe = "NO";
            break;
          }
          const appCycleDiff = gitDiffPathNonEmpty("assets/app.js");
          if (!appCycleDiff.ok || appCycleDiff.nonEmpty) {
            loopStopReason = "ASSETS_APP_JS_CHANGED";
            loopSafe = "NO";
            break;
          }
          completed += 1;
        }
        repOut.loop_cycles_completed = String(completed);
        repOut.loop_stop_reason = loopStopReason || "LOOP_COMPLETED";
        repOut.loop_safe_to_continue = loopSafe;
        if (completed === loopTarget && loopSafe === "YES") {
          repOut.loop_completed = "YES";
        } else {
          repOut.loop_completed = "NO";
          repOut.safe_to_continue = "NO";
          repOut.recommended_next_command =
            "STOP: inspect SILVER_CURSOR_OUTPUT.md and runtime dirty paths; fix blocker, then rerun npm run silver-auto -- --run-cursor --loop --max-cycles=" +
            String(loopTarget);
        }
      } else {
        const ar = runSilverCursorAdapter(adapter, { useWslUbuntuAgent });
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
