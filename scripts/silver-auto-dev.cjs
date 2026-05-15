#!/usr/bin/env node
/**
 * Silver Auto-Dev V1 — single-pass entrypoint: bounded safe PR queue, then deterministic
 * SILVER_NEXT_ACTION.md handoff when no ultra-safe PR candidate remains.
 * Does not call Cursor API. Does not modify assets/app.js or Silver engine.
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
const RHC3_REPORT = path.join(__dirname, "silver-real-human-chaos-v3-report.json");
const REALISTIC_MOBILE_REPORT = path.join(__dirname, "silver-realistic-mobile-corpus-report.json");

const MAX_BUFFER = 64 * 1024 * 1024;

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

function main() {
  const startedAt = new Date().toISOString();
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
    const repOut = {
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
    };
    writeDevReport(repOut);
    console.error(`SILVER_AUTO_DEV_PREFLIGHT_STOP: ${preflightFail}`);
    process.exit(1);
  }

  const orch = runCommand(process.execPath, [ORCHESTRATOR_SCRIPT, "--apply-safe-queue", "--max=3"]);
  queueExecuted = "YES";

  const parsed = readJsonFile(ORCHESTRATOR_REPORT);
  let qrep = parsed.ok ? parsed.data : null;
  if (!parsed.ok) {
    const repOut = {
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
    };
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
  };

  writeDevReport(repOut);

  if (!orch.ok) {
    console.error(orch.message || `orchestrator_exit_${orch.exitCode}`);
    process.exit(1);
  }

  process.exit(0);
}

try {
  main();
} catch (e) {
  const msg = String((e && e.message) || e || "unexpected_error");
  writeDevReport({
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
  });
  console.error(msg);
  process.exit(1);
}
