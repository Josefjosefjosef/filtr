#!/usr/bin/env node
/**
 * Silver PR Orchestrator V1 — DRY-RUN by default; optional `--apply-one-safe-pr`
 * for a single gated ultra-safe PR (docs/** or scripts/** only, LOW risk).
 * Optional `--apply-safe-queue --max=N` (N=1..5): bounded loop of child `--apply-one-safe-pr` runs.
 * Uses frozen backlog JSON (hints) + GitHub CLI: live `gh pr list --state open`
 * for the candidate pool, then `gh pr view` / `gh pr diff --name-only` per OPEN PR.
 * DRY-RUN never merges, pushes, or updates PR branches locally or via gh.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const GOVERNANCE_JSON = path.join(__dirname, "silver-pr-backlog-governance-v1-report.json");
const TRIAGE_JSON = path.join(__dirname, "silver-pr-backlog-needs-sync-triage-v1-report.json");
const OUT_REPORT = path.join(__dirname, "silver-pr-orchestrator-v1-report.json");
const OUT_REPORT_REL = "scripts/silver-pr-orchestrator-v1-report.json";

const MAX_BUFFER = 64 * 1024 * 1024;

/** After `gh pr update-branch`, GitHub may leave mergeStateStatus/mergeable UNKNOWN briefly; poll before giving up. */
const POST_SYNC_UNKNOWN_RECHECK_MAX_ATTEMPTS = 8;
const POST_SYNC_UNKNOWN_RECHECK_SLEEP_MS = 4000;

function sleepMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* ignore */
  }
}

/**
 * Safe wrapper for gh / git / node child processes. Never throws; returns structured result.
 */
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
  if (!r.ok) {
    return { ok: false, text: "", err: r.message || r.stderr };
  }
  return { ok: true, text: r.stdout };
}

function parsePorcelainPaths(porcelainText) {
  const out = [];
  const lines = String(porcelainText || "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  for (const line of lines) {
    if (line.startsWith("?? ")) {
      out.push(normalizePath(line.slice(3).trim()));
      continue;
    }
    const rest = line.length >= 4 ? line.slice(3).trim() : line.trim();
    if (rest.includes(" -> ")) {
      const parts = rest.split(" -> ");
      out.push(normalizePath(parts[0].trim()));
      out.push(normalizePath(parts[parts.length - 1].trim()));
    } else {
      out.push(normalizePath(rest));
    }
  }
  return out.filter(Boolean);
}

function isStrictCleanPorcelain(porcelainText) {
  return String(porcelainText || "").trim().length === 0;
}

function isCleanAfterOrchestratorRun(porcelainText) {
  if (isStrictCleanPorcelain(porcelainText)) return true;
  const paths = parsePorcelainPaths(porcelainText);
  if (!paths.length) return true;
  return paths.every((p) => p === OUT_REPORT_REL || p === normalizePath(OUT_REPORT));
}

function normalizePath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

/** Untracked or tracked SILVER_*.md runtime reports must not appear in porcelain during queue runs. */
function porcelainHasSilverRuntimeMd(paths) {
  for (const p of paths) {
    const base = path.posix.basename(normalizePath(p));
    if (/^SILVER_.+\.md$/i.test(base)) return true;
  }
  return false;
}

function ensureStrictCleanOrRestoreOrchestratorReportOnly() {
  let gs = gitPorcelain();
  if (!gs.ok) {
    return { ok: false, message: gs.err || "git_status_failed" };
  }
  if (isStrictCleanPorcelain(gs.text)) {
    return { ok: true, porcelain: gs.text };
  }
  if (!isCleanAfterOrchestratorRun(gs.text)) {
    return { ok: false, message: "WORKTREE_NOT_CLEAN" };
  }
  const restoreR = runCommand("git", ["restore", "--", OUT_REPORT_REL]);
  if (!restoreR.ok) {
    return { ok: false, message: restoreR.message || "git_restore_orchestrator_report_failed" };
  }
  gs = gitPorcelain();
  if (!gs.ok || !isStrictCleanPorcelain(gs.text)) {
    return { ok: false, message: "WORKTREE_NOT_CLEAN" };
  }
  return { ok: true, porcelain: gs.text };
}

function gitDiffAssetsAppJsNonEmpty() {
  const r = runCommand("git", ["diff", "--", "assets/app.js"]);
  if (!r.ok) {
    return { ok: false, nonEmpty: true, message: r.message || "git_diff_failed" };
  }
  return { ok: true, nonEmpty: String(r.stdout || "").trim().length > 0 };
}

function postCycleQueueGuards() {
  const gs = gitPorcelain();
  if (!gs.ok) {
    return { ok: false, reason: "git_status_failed", detail: gs.err || "" };
  }
  const paths = parsePorcelainPaths(gs.text);
  if (porcelainHasSilverRuntimeMd(paths)) {
    return { ok: false, reason: "runtime_silver_md_in_porcelain", detail: paths.join(",") };
  }
  if (!isStrictCleanPorcelain(gs.text) && !isCleanAfterOrchestratorRun(gs.text)) {
    return { ok: false, reason: "worktree_not_clean", detail: gs.text.trim() };
  }
  const diffR = gitDiffAssetsAppJsNonEmpty();
  if (!diffR.ok || diffR.nonEmpty) {
    return { ok: false, reason: "assets_app_js_diff_non_empty", detail: diffR.message || "" };
  }
  return { ok: true, reason: "", detail: "" };
}

function readJsonFile(abs) {
  const r = { ok: false, data: null, message: "" };
  try {
    if (!fs.existsSync(abs)) {
      r.message = `missing_file:${path.relative(REPO, abs)}`;
      return r;
    }
    const raw = fs.readFileSync(abs, "utf8");
    r.data = JSON.parse(raw);
    r.ok = true;
    return r;
  } catch (e) {
    r.message = String(e.message || e || "json_read_failed");
    return r;
  }
}

function baseReport() {
  return {
    generatedAt: new Date().toISOString(),
    mode: "DRY_RUN",
    apply_mode: "NO",
    apply_candidate_pr: null,
    apply_sync_attempted: "NO",
    apply_sync_result: "NOT_RUN",
    apply_merge_attempted: "NO",
    apply_merge_result: "NOT_RUN",
    apply_post_merge_proof: "NOT_RUN",
    apply_stopped_reason: "",
    post_sync_recheck_attempted: "NO",
    post_sync_recheck_count: 0,
    post_sync_merge_state_final: "",
    post_sync_mergeable_final: "",
    safe_to_continue: "",
    main_commit: "",
    governance_loaded: false,
    triage_loaded: false,
    governance_total_open_prs: null,
    total_open_prs: null,
    safe_open_candidates: null,
    recommended_first_safe_candidate: null,
    recommended_first_safe_candidate_state: "",
    open_backlog_refresh: "NO",
    open_pr_filter_active: "NO",
    candidate_pr: null,
    candidate_state: "",
    apply_candidate_state: null,
    candidate_title: null,
    candidate_url: null,
    candidate_head_ref: null,
    candidate_base_ref: null,
    candidate_category: null,
    governance_category: null,
    candidate_files: [],
    merge_state_status: "",
    mergeable: "",
    status_checks_summary: {
      total: 0,
      completed: 0,
      failed: 0,
      pending: 0,
      success: 0,
      skipped: 0,
      cancelled: 0,
      neutral: 0,
      failedNames: [],
      pendingNames: [],
    },
    risk_level: "UNKNOWN",
    allowed_action: "STOP_FAIL",
    blocked_reason: "",
    would_merge: "NO",
    would_push: "NO",
    engine_changed: "NO",
    assets_app_changed: "NO",
    safe_to_enable_apply_mode: "NO",
    recommended_next_command: "",
    error: "NO",
    error_stage: "",
    error_message: "",
    git_status_clean_before: "NO",
    git_status_clean_after: "NO",
    dry_run_no_push_merge: "YES",
    branch_isolation_gh_only: "YES",
    queue_mode: "NO",
    queue_max: null,
    queue_cycles_completed: 0,
    queue_stop_reason: "",
    queue_safe_to_continue: "",
  };
}

function writeReportFile(reportObj) {
  fs.writeFileSync(OUT_REPORT, `${JSON.stringify(reportObj, null, 2)}\n`, "utf8");
}

function tryCheckoutMain() {
  runCommand("git", ["checkout", "main"]);
}

function listChangedPathsFromGhNameOnly(prNumber) {
  const r = runCommand("gh", ["pr", "diff", String(prNumber), "--name-only"]);
  if (!r.ok) {
    return { ok: false, paths: [], message: r.message || r.stderr || "gh_pr_diff_failed" };
  }
  const paths = r.stdout
    .split(/\r?\n/)
    .map((line) => normalizePath(line.trim()))
    .filter(Boolean);
  return { ok: true, paths };
}

/**
 * Live OPEN PR numbers from GitHub (frozen backlog JSON is not used for pool membership).
 */
function listOpenPrNumbersFromGh() {
  const r = runGhJsonWithRetry([
    "pr",
    "list",
    "--state",
    "open",
    "--json",
    "number",
    "--limit",
    "500",
  ]);
  if (!r.ok || !Array.isArray(r.data)) {
    return { ok: false, numbers: [], message: r.message || "gh_pr_list_open_failed" };
  }
  const numbers = r.data
    .map((row) => (row && typeof row.number === "number" ? row.number : null))
    .filter((n) => n !== null)
    .sort((a, b) => a - b);
  return { ok: true, numbers, message: "" };
}

function governanceCategoryForPr(governance, prNumber) {
  let governanceCategory = "";
  if (governance && Array.isArray(governance.top_needs_sync)) {
    const hit = governance.top_needs_sync.find((p) => p && p.number === prNumber);
    if (hit && hit.category) governanceCategory = String(hit.category);
  }
  return governanceCategory;
}

function triageCategoryForPr(triage, prNumber) {
  if (triage && Array.isArray(triage.prs)) {
    const hit = triage.prs.find((p) => p && p.number === prNumber);
    if (hit && hit.triageCategory) return String(hit.triageCategory);
  }
  const rec = triage && triage.recommended_first_sync_candidate;
  if (rec && rec.number === prNumber) {
    return String(rec.triageCategory || rec.category || "UNKNOWN");
  }
  return "UNKNOWN";
}

/**
 * Scans every OPEN PR (ascending number): counts ultra-safe apply candidates; returns first match.
 */
function scanOpenPrSafePool(governance, triage, openNumbers) {
  let safeCount = 0;
  let firstPick = null;
  for (const prNumber of openNumbers) {
    const prJson = runGhJsonWithRetry([
      "pr",
      "view",
      String(prNumber),
      "--json",
      "number,title,url,headRefName,baseRefName,mergeStateStatus,mergeable,statusCheckRollup,isDraft,state",
    ]);
    if (!prJson.ok) {
      return { ok: false, safeCount, firstPick, message: prJson.message || "gh_pr_view_failed" };
    }
    const prView = prJson.data;
    if (!prView || !isPrViewOpen(prView)) {
      continue;
    }
    const diffPaths = listChangedPathsFromGhNameOnly(prNumber);
    if (!diffPaths.ok) {
      return { ok: false, safeCount, firstPick, message: diffPaths.message || "gh_pr_diff_failed" };
    }
    const triageCategory = triageCategoryForPr(triage, prNumber);
    const governanceCategory = governanceCategoryForPr(governance, prNumber);
    const evalResult = evaluateCandidate(prView, diffPaths.paths, {
      governanceCategory,
      triageCategory,
    });
    const gates = applyUltraSafeGates(evalResult, prView);
    if (gates.ok) {
      safeCount += 1;
      if (!firstPick) {
        firstPick = {
          prNumber,
          prView,
          diffPaths,
          triageCategory,
          governanceCategory,
          evalResult,
        };
      }
    }
  }
  return { ok: true, safeCount, firstPick, message: "" };
}

function runGhJsonWithRetry(args) {
  const maxAttempts = 5;
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const r = runCommand("gh", args);
    if (r.ok) {
      try {
        return { ok: true, data: JSON.parse(r.stdout) };
      } catch (e) {
        last = { ok: false, message: `json_parse:${String(e.message || e)}` };
        break;
      }
    }
    last = { ok: false, message: r.message || r.stderr || "gh_failed" };
    const msg = `${r.stderr || ""}${r.message || ""}`;
    const retryable = /502|503|504|timeout|ECONNRESET|ETIMEDOUT|rate limit/i.test(msg);
    if (!retryable || attempt === maxAttempts) break;
    sleepMs(800 * attempt);
  }
  return last && last.ok ? last : { ok: false, message: (last && last.message) || "gh_json_failed" };
}

function summarizeChecks(statusCheckRollup) {
  const summary = {
    total: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    success: 0,
    skipped: 0,
    cancelled: 0,
    neutral: 0,
    failedNames: [],
    pendingNames: [],
  };
  if (!Array.isArray(statusCheckRollup)) return summary;
  for (const c of statusCheckRollup) {
    summary.total += 1;
    const name = String((c && c.name) || "");
    const status = String((c && c.status) || "").toUpperCase();
    const conclusion = String((c && c.conclusion) || "").toUpperCase();
    if (status === "COMPLETED") summary.completed += 1;
    if (
      status === "IN_PROGRESS" ||
      status === "QUEUED" ||
      status === "PENDING" ||
      status === "WAITING"
    ) {
      summary.pending += 1;
      if (name) summary.pendingNames.push(name);
      continue;
    }
    if (
      conclusion === "FAILURE" ||
      conclusion === "TIMED_OUT" ||
      conclusion === "ACTION_REQUIRED"
    ) {
      summary.failed += 1;
      if (name) summary.failedNames.push(name);
    } else if (conclusion === "SUCCESS") summary.success += 1;
    else if (conclusion === "SKIPPED") summary.skipped += 1;
    else if (conclusion === "CANCELLED") summary.cancelled += 1;
    else if (conclusion === "NEUTRAL") summary.neutral += 1;
  }
  return summary;
}

function hasAssetsAppJs(paths) {
  return paths.some((p) => p === "assets/app.js" || p.endsWith("/assets/app.js"));
}

function hasAssetsAppCss(paths) {
  return paths.some((p) => p === "assets/app.css" || p.endsWith("/assets/app.css"));
}

function hasGithubWorkflow(paths) {
  return paths.some((p) => p.startsWith(".github/workflows/"));
}

function isOnlyDocs(paths) {
  if (!paths.length) return false;
  return paths.every((p) => /^docs\//.test(p));
}

function isOnlyScripts(paths) {
  if (!paths.length) return false;
  return paths.every((p) => /^scripts\//.test(p));
}

function isLowRiskDocsOrScriptsOnly(paths) {
  return isOnlyDocs(paths) || isOnlyScripts(paths);
}

function touchesEngineishPath(paths) {
  return paths.some((p) => {
    if (/^assets\//.test(p)) return true;
    if (p === "projects/index.html") return true;
    if (/^projects\//.test(p) && !/^projects\/data\//.test(p)) return true;
    if (/^server\//.test(p)) return true;
    if (/^cloudflare\//.test(p)) return true;
    if (/^functions\//.test(p)) return true;
    return false;
  });
}

function yn(b) {
  return b ? "YES" : "NO";
}

/** GitHub `gh pr view` JSON: state is OPEN | CLOSED | MERGED (case varies). */
function isPrViewOpen(prView) {
  if (!prView) return false;
  const st = String(prView.state || "").toUpperCase();
  return st === "OPEN";
}

function prViewStateString(prView) {
  return String((prView && prView.state) || "");
}

function evaluateCandidate(prView, changedPaths, hints) {
  const h = hints && typeof hints === "object" ? hints : {};
  const governanceCategoryHint = String(h.governanceCategory || "");
  const triageCategoryHint = String(h.triageCategory || "");
  const paths = changedPaths;
  const checks = summarizeChecks(prView.statusCheckRollup);
  const mergeState = String(prView.mergeStateStatus || "").toUpperCase();
  const mergeable = String(prView.mergeable || "").toUpperCase();
  const isDraft = Boolean(prView.isDraft);

  const base = {
    candidate_files: paths,
    status_checks_summary: checks,
    merge_state_status: mergeState,
    mergeable,
    risk_level: "UNKNOWN",
    allowed_action: "STOP_UNKNOWN",
    blocked_reason: "",
    would_merge: "NO",
    would_push: "NO",
    engine_changed: yn(touchesEngineishPath(paths)),
    assets_app_changed: yn(hasAssetsAppJs(paths)),
  };

  if (isDraft) {
    return {
      ...base,
      risk_level: "UNKNOWN",
      allowed_action: "STOP_UNKNOWN",
      blocked_reason: "draft_pr",
      recommended_next_command: `gh pr view ${prView.number} --web`,
    };
  }

  if (!isPrViewOpen(prView)) {
    return {
      ...base,
      risk_level: "BLOCKED",
      allowed_action: "STOP_CLOSED_OR_MERGED",
      blocked_reason: "pr_not_open",
      would_merge: "NO",
      would_push: "NO",
      recommended_next_command: `gh pr view ${prView.number} --web`,
    };
  }

  if (hasAssetsAppJs(paths)) {
    return {
      ...base,
      risk_level: "HIGH",
      allowed_action: "STOP_HIGH_RISK",
      blocked_reason: "touches_assets_app_js",
      recommended_next_command: "manual_review_required_do_not_automerge",
    };
  }

  if (hasAssetsAppCss(paths)) {
    return {
      ...base,
      risk_level: "UNKNOWN",
      allowed_action: "STOP_UNKNOWN",
      blocked_reason: "touches_assets_app_css",
      recommended_next_command: "manual_review_required_do_not_automerge",
    };
  }

  if (hasGithubWorkflow(paths)) {
    return {
      ...base,
      risk_level: "UNKNOWN",
      allowed_action: "STOP_UNKNOWN",
      blocked_reason: "touches_github_workflows",
      recommended_next_command: "manual_review_required_do_not_automerge",
    };
  }

  if (mergeable === "CONFLICTING" || mergeState === "DIRTY" || mergeState === "CONFLICTING") {
    return {
      ...base,
      risk_level: "HIGH",
      allowed_action: "STOP_CONFLICTING",
      blocked_reason: "merge_conflict_or_dirty",
      recommended_next_command: `gh pr view ${prView.number} --web`,
    };
  }

  if (checks.pending > 0) {
    return {
      ...base,
      risk_level: "UNKNOWN",
      allowed_action: "STOP_PENDING",
      blocked_reason: `checks_pending:${checks.pendingNames.join(",")}`,
      recommended_next_command: `gh pr checks ${prView.number}`,
    };
  }

  if (checks.failed > 0) {
    return {
      ...base,
      risk_level: "HIGH",
      allowed_action: "STOP_FAIL",
      blocked_reason: `checks_failed:${checks.failedNames.join(",")}`,
      recommended_next_command: `gh pr checks ${prView.number}`,
    };
  }

  if (mergeState === "BEHIND" && isLowRiskDocsOrScriptsOnly(paths)) {
    return {
      ...base,
      risk_level: "LOW",
      allowed_action: "SYNC_ONLY",
      blocked_reason: "branch_behind_base_sync_first",
      would_merge: "NO",
      would_push: "YES",
      recommended_next_command: `gh pr update-branch ${prView.number}`,
    };
  }

  const checksClean = checks.pending === 0 && checks.failed === 0;
  const needsSyncFromBacklog =
    governanceCategoryHint === "NEEDS_REBASE_OR_SYNC" ||
    triageCategoryHint === "SYNC_SAFE_LOW_RISK" ||
    /NEEDS_REBASE|NEEDS_SYNC|REBASE_OR_SYNC/i.test(triageCategoryHint) ||
    /NEEDS_REBASE_OR_SYNC/i.test(governanceCategoryHint);

  if (
    mergeState === "UNKNOWN" &&
    mergeable === "MERGEABLE" &&
    isLowRiskDocsOrScriptsOnly(paths) &&
    checksClean &&
    needsSyncFromBacklog
  ) {
    return {
      ...base,
      risk_level: "LOW",
      allowed_action: "SYNC_ONLY",
      blocked_reason: "merge_state_unknown_sync_first",
      would_merge: "NO",
      would_push: "YES",
      recommended_next_command: `gh pr update-branch ${prView.number}`,
    };
  }

  const ultraSafeUnknownMergeability =
    governanceCategoryHint === "NEEDS_REBASE_OR_SYNC" &&
    triageCategoryHint === "SYNC_SAFE_LOW_RISK" &&
    isLowRiskDocsOrScriptsOnly(paths) &&
    paths.length > 0 &&
    checksClean;

  if (
    mergeState === "UNKNOWN" &&
    mergeable === "UNKNOWN" &&
    ultraSafeUnknownMergeability
  ) {
    return {
      ...base,
      risk_level: "LOW",
      allowed_action: "SYNC_ONLY",
      blocked_reason: "branch_behind_base_sync_first",
      would_merge: "NO",
      would_push: "NO",
      recommended_next_command: `gh pr update-branch ${prView.number}`,
    };
  }

  const mergeClean = mergeState === "CLEAN";

  if (mergeClean && isOnlyDocs(paths) && checksClean) {
    return {
      ...base,
      risk_level: "LOW",
      allowed_action: "VERIFY_AND_MERGE_IF_CLEAN",
      blocked_reason: "",
      would_merge: "YES",
      would_push: "NO",
      recommended_next_command: `gh pr merge ${prView.number} --merge`,
    };
  }

  if (mergeClean && isOnlyScripts(paths) && checksClean) {
    return {
      ...base,
      risk_level: "LOW",
      allowed_action: "VERIFY_AND_MERGE_IF_CLEAN",
      blocked_reason: "",
      would_merge: "YES",
      would_push: "NO",
      recommended_next_command: `gh pr merge ${prView.number} --merge`,
    };
  }

  if (mergeClean && checksClean && isLowRiskDocsOrScriptsOnly(paths)) {
    return {
      ...base,
      risk_level: "LOW",
      allowed_action: "VERIFY_ONLY",
      blocked_reason: "",
      would_merge: "NO",
      would_push: "NO",
      recommended_next_command: `gh pr checks ${prView.number}`,
    };
  }

  if (touchesEngineishPath(paths)) {
    return {
      ...base,
      risk_level: "HIGH",
      allowed_action: "STOP_UNKNOWN",
      blocked_reason: "touches_engine_or_product_surface",
      recommended_next_command: `gh pr view ${prView.number} --web`,
    };
  }

  const diagParts = [
    `merge_state=${mergeState || "EMPTY"}`,
    `mergeable=${mergeable || "EMPTY"}`,
    `paths_n=${paths.length}`,
    `low_risk_docs_scripts=${yn(isLowRiskDocsOrScriptsOnly(paths))}`,
    `pending=${checks.pending}`,
    `failed=${checks.failed}`,
    `governance_cat=${governanceCategoryHint || "EMPTY"}`,
    `triage_cat=${triageCategoryHint || "EMPTY"}`,
  ];
  return {
    ...base,
    risk_level: "UNKNOWN",
    allowed_action: "STOP_UNKNOWN",
    blocked_reason: `unclassified_paths_or_merge_state;${diagParts.join(";")}`,
    recommended_next_command: `gh pr view ${prView.number} --web`,
  };
}

function safeToEnableApply(evalResult, gitCleanAfterOk) {
  if (!gitCleanAfterOk) return "NO";
  const a = evalResult.allowed_action;
  if (a === "no_safe_candidate") return "NO";
  if (a === "STOP_HIGH_RISK" || a === "STOP_CONFLICTING" || a === "STOP_PENDING" || a === "STOP_FAIL") {
    return "NO";
  }
  if (a === "STOP_CLOSED_OR_MERGED") return "NO";
  if (a === "STOP_UNKNOWN") return "NO";
  if (a === "SYNC_ONLY" || a === "VERIFY_AND_MERGE_IF_CLEAN") {
    return evalResult.risk_level === "LOW" ? "YES" : "NO";
  }
  if (a === "VERIFY_ONLY") return "NO";
  return "NO";
}

function finalizeDryRunReport(report) {
  report.mode = "DRY_RUN";
  report.apply_mode = "NO";
  report.would_merge = "NO";
  report.would_push = "NO";
  report.dry_run_no_push_merge = "YES";
}

function applyUltraSafeGates(evalResult, prView) {
  if (prView && !isPrViewOpen(prView)) return { ok: false, reason: "pr_not_open" };
  if (evalResult.risk_level !== "LOW") return { ok: false, reason: "risk_not_low" };
  const paths = evalResult.candidate_files || [];
  if (!isLowRiskDocsOrScriptsOnly(paths)) return { ok: false, reason: "paths_not_docs_or_scripts_only" };
  if (hasAssetsAppJs(paths) || hasAssetsAppCss(paths) || hasGithubWorkflow(paths)) {
    return { ok: false, reason: "forbidden_path_surface" };
  }
  const ch = evalResult.status_checks_summary;
  if (ch && (ch.failed > 0 || ch.pending > 0)) return { ok: false, reason: "checks_not_clean" };
  const ms = String(evalResult.merge_state_status || "").toUpperCase();
  const mg = String(evalResult.mergeable || "").toUpperCase();
  if (mg === "CONFLICTING" || ms === "DIRTY" || ms === "CONFLICTING") {
    return { ok: false, reason: "conflicting_or_dirty" };
  }
  const aa = evalResult.allowed_action;
  if (aa !== "SYNC_ONLY" && aa !== "VERIFY_AND_MERGE_IF_CLEAN") {
    return { ok: false, reason: `allowed_action:${aa}` };
  }
  return { ok: true, reason: "" };
}

/**
 * After a successful `gh pr update-branch`, GitHub sometimes returns mergeStateStatus=UNKNOWN
 * and mergeable=UNKNOWN even when paths are scripts/docs-only and checks are idle. Recheck
 * with `gh pr view` + `gh pr checks` before treating that as a final stop.
 */
function shouldPostSyncRecheckUnknownMergeState(curPrView, paths, evalResult) {
  if (!curPrView || !isPrViewOpen(curPrView)) return false;
  if (!paths || !paths.length || !isLowRiskDocsOrScriptsOnly(paths)) return false;
  if (hasAssetsAppJs(paths) || hasAssetsAppCss(paths) || hasGithubWorkflow(paths)) return false;
  const ch = evalResult.status_checks_summary;
  if (!ch || ch.pending > 0 || ch.failed > 0) return false;
  const ms = String(evalResult.merge_state_status || "").toUpperCase();
  const mg = String(evalResult.mergeable || "").toUpperCase();
  return ms === "UNKNOWN" && mg === "UNKNOWN";
}

function waitForPrChecksIdle(prNumber, maxWaitMs, pollMs) {
  const deadline = Date.now() + maxWaitMs;
  let lastSummary = null;
  while (Date.now() < deadline) {
    const prJson = runGhJsonWithRetry([
      "pr",
      "view",
      String(prNumber),
      "--json",
      "number,title,url,headRefName,baseRefName,mergeStateStatus,mergeable,statusCheckRollup,isDraft,state",
    ]);
    if (!prJson.ok) {
      return { ok: false, prView: null, message: prJson.message || "gh_poll_failed", summary: lastSummary };
    }
    const prView = prJson.data;
    if (!isPrViewOpen(prView)) {
      return { ok: false, prView, message: "pr_not_open", summary: lastSummary };
    }
    const summary = summarizeChecks(prView.statusCheckRollup);
    lastSummary = summary;
    if (summary.pending === 0) {
      return { ok: true, prView, message: "", summary };
    }
    sleepMs(pollMs);
  }
  return { ok: false, prView: null, message: "ci_wait_timeout", summary: lastSummary };
}

function reverifyMergeReady(prView, paths, evalResult) {
  if (!prView || prView.isDraft) return { ok: false, reason: "draft_or_missing_pr" };
  if (!isPrViewOpen(prView)) return { ok: false, reason: "pr_not_open" };
  const diffOk = isLowRiskDocsOrScriptsOnly(paths);
  if (!diffOk) return { ok: false, reason: "paths_changed" };
  if (hasAssetsAppJs(paths) || hasAssetsAppCss(paths) || hasGithubWorkflow(paths)) {
    return { ok: false, reason: "forbidden_paths" };
  }
  const ch = summarizeChecks(prView.statusCheckRollup);
  if (ch.failed > 0 || ch.pending > 0) return { ok: false, reason: "checks_not_pass" };
  const ms = String(prView.mergeStateStatus || "").toUpperCase();
  const mg = String(prView.mergeable || "").toUpperCase();
  if (mg === "CONFLICTING" || ms === "DIRTY" || ms === "CONFLICTING") {
    return { ok: false, reason: "merge_not_clean" };
  }
  if (ms !== "CLEAN") return { ok: false, reason: `merge_state_not_clean:${ms || "EMPTY"}` };
  if (evalResult.risk_level !== "LOW") return { ok: false, reason: "risk_not_low" };
  if (evalResult.allowed_action !== "VERIFY_AND_MERGE_IF_CLEAN") {
    return { ok: false, reason: `action_not_merge:${evalResult.allowed_action}` };
  }
  return { ok: true, reason: "" };
}

function runNodeOrchestratorDryRun() {
  const exe = process.execPath;
  return runCommand(exe, [path.join(__dirname, "silver-pr-orchestrator-v1.cjs"), "--dry-run"], {
    cwd: REPO,
  });
}

function runSilverAutopilotStatus() {
  const exe = process.execPath;
  return runCommand(exe, [path.join(__dirname, "silver-autopilot.cjs"), "--status"], { cwd: REPO });
}

function runNpmSmoke() {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  return runCommand(npmCmd, ["run", "smoke"], { cwd: REPO });
}

function buildReportSkeleton(
  ctx,
  mainCommit,
  governance,
  triage,
  prView,
  triageCategory,
  governanceCategory,
  evalResult,
  openPoolMeta,
) {
  const meta =
    openPoolMeta && typeof openPoolMeta === "object"
      ? openPoolMeta
      : {
          total_open_prs: null,
          safe_open_candidates: null,
          recommended_first_safe_candidate: null,
          recommended_first_safe_candidate_state: "",
          open_backlog_refresh: "NO",
          open_pr_filter_active: "NO",
        };
  const hasPr = prView != null;
  const govCatStr = String(governanceCategory || "");
  return {
    ...baseReport(),
    generatedAt: new Date().toISOString(),
    main_commit: mainCommit,
    governance_loaded: true,
    triage_loaded: true,
    governance_total_open_prs: governance.total_open_prs,
    total_open_prs: meta.total_open_prs,
    safe_open_candidates: meta.safe_open_candidates,
    recommended_first_safe_candidate: meta.recommended_first_safe_candidate,
    recommended_first_safe_candidate_state: meta.recommended_first_safe_candidate_state,
    open_backlog_refresh: meta.open_backlog_refresh,
    open_pr_filter_active: meta.open_pr_filter_active,
    candidate_pr: hasPr ? prView.number : null,
    candidate_state: hasPr ? prViewStateString(prView) : "",
    apply_candidate_state: null,
    candidate_title: hasPr ? prView.title : null,
    candidate_url: hasPr ? prView.url : null,
    candidate_head_ref: hasPr ? prView.headRefName : null,
    candidate_base_ref: hasPr ? prView.baseRefName : null,
    candidate_category: hasPr ? triageCategory : null,
    governance_category: hasPr && govCatStr.length ? govCatStr : null,
    candidate_files: evalResult.candidate_files,
    merge_state_status: evalResult.merge_state_status,
    mergeable: evalResult.mergeable,
    status_checks_summary: evalResult.status_checks_summary,
    risk_level: evalResult.risk_level,
    allowed_action: evalResult.allowed_action,
    blocked_reason: evalResult.blocked_reason,
    would_merge: evalResult.would_merge,
    would_push: evalResult.would_push,
    engine_changed: evalResult.engine_changed,
    assets_app_changed: evalResult.assets_app_changed,
    safe_to_enable_apply_mode: "NO",
    recommended_next_command: evalResult.recommended_next_command,
    error: "NO",
    error_stage: "",
    error_message: "",
    git_status_clean_before: ctx.git_status_clean_before,
    git_status_clean_after: "NO",
    dry_run_no_push_merge: "YES",
    branch_isolation_gh_only: "YES",
  };
}

function writeApplyPassReport(rep) {
  const gsFinal = gitPorcelain();
  const afterCleanOk = gsFinal.ok && isCleanAfterOrchestratorRun(gsFinal.text);
  const gitCleanAfterStrict = gsFinal.ok && isStrictCleanPorcelain(gsFinal.text);
  rep.git_status_clean_after = gitCleanAfterStrict || afterCleanOk ? "YES" : "NO";
  if (rep.mode === "DRY_RUN") {
    rep.safe_to_enable_apply_mode = safeToEnableApply(
      {
        risk_level: rep.risk_level,
        allowed_action: rep.allowed_action,
      },
      afterCleanOk,
    );
    if (!afterCleanOk) rep.safe_to_enable_apply_mode = "NO";
  }
  writeReportFile(rep);
  console.log(`Wrote ${path.relative(REPO, OUT_REPORT)}`);
}

function exitApplyZero(rep) {
  writeApplyPassReport(rep);
  process.exit(0);
}

function exitWithErrorReport(ctx, stage, message, blockedReason, extras, attemptMain) {
  const rep = { ...baseReport(), ...extras };
  rep.generatedAt = new Date().toISOString();
  if (!(extras && extras.mode)) {
    rep.mode = "DRY_RUN";
  }
  rep.error = "YES";
  rep.error_stage = stage;
  rep.error_message = message;
  rep.blocked_reason = blockedReason || message;
  rep.allowed_action = "STOP_FAIL";
  rep.would_merge = "NO";
  rep.would_push = "NO";
  rep.safe_to_enable_apply_mode = "NO";
  rep.dry_run_no_push_merge = "YES";
  rep.branch_isolation_gh_only = "YES";
  if (ctx && ctx.git_status_clean_before != null) {
    rep.git_status_clean_before = ctx.git_status_clean_before;
  }
  writeReportFile(rep);
  if (attemptMain) tryCheckoutMain();
  const after = gitPorcelain();
  if (after.ok) {
    rep.git_status_clean_after = isCleanAfterOrchestratorRun(after.text) ? "YES" : "NO";
  } else {
    rep.git_status_clean_after = "NO";
  }
  writeReportFile(rep);
  console.error(message);
  process.exit(1);
}

function argvUsageError() {
  const rep = baseReport();
  rep.error = "YES";
  rep.error_stage = "argv";
  rep.error_message = "invalid_arguments";
  rep.blocked_reason = "usage_invalid_arguments_dry_run_apply_one_or_apply_safe_queue";
  rep.queue_mode = "NO";
  rep.queue_max = null;
  rep.queue_cycles_completed = 0;
  rep.queue_stop_reason = "argv_invalid";
  rep.queue_safe_to_continue = "NO";
  const gsA = gitPorcelain();
  rep.git_status_clean_before = gsA.ok && isStrictCleanPorcelain(gsA.text) ? "YES" : "NO";
  writeReportFile(rep);
  const gsB = gitPorcelain();
  rep.git_status_clean_after = gsB.ok && isCleanAfterOrchestratorRun(gsB.text) ? "YES" : "NO";
  writeReportFile(rep);
  console.error(
    "Usage: node scripts/silver-pr-orchestrator-v1.cjs --dry-run\n       node scripts/silver-pr-orchestrator-v1.cjs --apply-one-safe-pr\n       node scripts/silver-pr-orchestrator-v1.cjs --apply-safe-queue --max=N   (N must be 1..5; exactly one --max= flag)",
  );
  process.exit(2);
}

function runDryRunNoSafeOpenCandidate(ctx, mainCommit, governance, triage, totalOpen, safeCount) {
  const emptyChecks = {
    total: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    success: 0,
    skipped: 0,
    cancelled: 0,
    neutral: 0,
    failedNames: [],
    pendingNames: [],
  };
  const evalResult = {
    candidate_files: [],
    status_checks_summary: emptyChecks,
    merge_state_status: "",
    mergeable: "",
    risk_level: "NONE",
    allowed_action: "no_safe_candidate",
    blocked_reason: "no_safe_open_ultra_apply_candidate",
    would_merge: "NO",
    would_push: "NO",
    engine_changed: "NO",
    assets_app_changed: "NO",
    recommended_next_command: "node scripts/silver-pr-orchestrator-v1.cjs --dry-run",
  };
  const openPoolMeta = {
    total_open_prs: totalOpen,
    safe_open_candidates: safeCount,
    recommended_first_safe_candidate: null,
    recommended_first_safe_candidate_state: "",
    open_backlog_refresh: "YES",
    open_pr_filter_active: "YES",
  };
  const report = buildReportSkeleton(
    ctx,
    mainCommit,
    governance,
    triage,
    null,
    "",
    "",
    evalResult,
    openPoolMeta,
  );
  report.safe_to_continue = "YES";
  finalizeDryRunReport(report);
  writeReportFile(report);

  const gsFinal = gitPorcelain();
  const afterCleanOk = gsFinal.ok && isCleanAfterOrchestratorRun(gsFinal.text);
  const gitCleanAfterStrict = gsFinal.ok && isStrictCleanPorcelain(gsFinal.text);
  report.git_status_clean_after = gitCleanAfterStrict || afterCleanOk ? "YES" : "NO";
  report.safe_to_enable_apply_mode = safeToEnableApply(evalResult, afterCleanOk);
  if (!afterCleanOk) {
    report.safe_to_enable_apply_mode = "NO";
  }

  writeReportFile(report);
  console.log(`Wrote ${path.relative(REPO, OUT_REPORT)}`);
}

function runDryRunMain(
  ctx,
  mainCommit,
  governance,
  triage,
  prNumber,
  triageCategory,
  governanceCategory,
  prView,
  diffPaths,
  openPoolMeta,
) {
  const evalResult = evaluateCandidate(prView, diffPaths.paths, {
    governanceCategory,
    triageCategory,
  });

  const report = buildReportSkeleton(
    ctx,
    mainCommit,
    governance,
    triage,
    prView,
    triageCategory,
    governanceCategory,
    evalResult,
    openPoolMeta,
  );
  report.safe_to_continue = "YES";
  finalizeDryRunReport(report);
  writeReportFile(report);

  const gsFinal = gitPorcelain();
  const afterCleanOk = gsFinal.ok && isCleanAfterOrchestratorRun(gsFinal.text);
  const gitCleanAfterStrict = gsFinal.ok && isStrictCleanPorcelain(gsFinal.text);
  report.git_status_clean_after = gitCleanAfterStrict || afterCleanOk ? "YES" : "NO";
  report.safe_to_enable_apply_mode = safeToEnableApply(evalResult, afterCleanOk);
  if (!afterCleanOk) {
    report.safe_to_enable_apply_mode = "NO";
  }

  writeReportFile(report);
  console.log(`Wrote ${path.relative(REPO, OUT_REPORT)}`);
}

function runApplyOneSafePrMain(
  ctx,
  mainCommit,
  governance,
  triage,
  prNumber,
  triageCategory,
  governanceCategory,
  prView,
  diffPaths,
  openPoolMeta,
) {
  let curPrView = prView;
  let curPaths = diffPaths.paths;
  let evalResult = evaluateCandidate(curPrView, curPaths, {
    governanceCategory,
    triageCategory,
  });

  const gates = applyUltraSafeGates(evalResult, curPrView);
  const report = buildReportSkeleton(
    ctx,
    mainCommit,
    governance,
    triage,
    curPrView,
    triageCategory,
    governanceCategory,
    evalResult,
    openPoolMeta,
  );
  report.mode = "APPLY_ONE_SAFE_PR";
  report.apply_mode = "YES";
  report.apply_candidate_pr = gates.ok ? prNumber : null;
  report.apply_candidate_state = gates.ok ? prViewStateString(curPrView) : null;
  report.dry_run_no_push_merge = "NO";
  report.branch_isolation_gh_only = "NO";
  report.apply_sync_attempted = "NO";
  report.apply_sync_result = "NOT_RUN";
  report.apply_merge_attempted = "NO";
  report.apply_merge_result = "NOT_RUN";
  report.apply_post_merge_proof = "NOT_RUN";
  report.apply_stopped_reason = "";
  report.post_sync_recheck_attempted = "NO";
  report.post_sync_recheck_count = 0;
  report.post_sync_merge_state_final = "";
  report.post_sync_mergeable_final = "";
  report.safe_to_continue = "NO";

  if (!gates.ok) {
    report.apply_stopped_reason = "no_safe_candidate";
    report.apply_candidate_pr = null;
    report.apply_candidate_state = null;
    report.apply_merge_attempted = "NO";
    report.safe_to_continue = "YES";
    report.recommended_next_command = "node scripts/silver-pr-orchestrator-v1.cjs --dry-run";
    exitApplyZero(report);
    return;
  }

  if (evalResult.allowed_action === "SYNC_ONLY") {
    const preSyncOpen = runGhJsonWithRetry([
      "pr",
      "view",
      String(prNumber),
      "--json",
      "number,state,title,url,headRefName,baseRefName,mergeStateStatus,mergeable,statusCheckRollup,isDraft",
    ]);
    if (!preSyncOpen.ok || !preSyncOpen.data) {
      report.apply_sync_attempted = "NO";
      report.apply_merge_attempted = "NO";
      report.apply_stopped_reason = "pre_sync_gh_pr_view_failed";
      report.safe_to_continue = "NO";
      exitApplyZero(report);
      return;
    }
    if (!isPrViewOpen(preSyncOpen.data)) {
      report.apply_sync_attempted = "NO";
      report.apply_merge_attempted = "NO";
      report.apply_stopped_reason = "pr_not_open";
      report.candidate_state = prViewStateString(preSyncOpen.data);
      report.apply_candidate_state = prViewStateString(preSyncOpen.data);
      report.safe_to_continue = "YES";
      exitApplyZero(report);
      return;
    }
    curPrView = preSyncOpen.data;
    report.apply_sync_attempted = "YES";
    const syncR = runCommand("gh", ["pr", "update-branch", String(prNumber)]);
    if (!syncR.ok) {
      report.apply_sync_result = "FAIL";
      report.apply_stopped_reason = "sync_failed";
      report.safe_to_continue = "NO";
      exitApplyZero(report);
      return;
    }
    report.apply_sync_result = "PASS";

    const waitR = waitForPrChecksIdle(prNumber, 50 * 60 * 1000, 15000);
    if (!waitR.ok || !waitR.prView) {
      report.apply_sync_result = "FAIL";
      if (waitR.message === "pr_not_open") {
        report.apply_stopped_reason = "pr_not_open";
        report.apply_sync_attempted = "YES";
        report.candidate_state = waitR.prView ? prViewStateString(waitR.prView) : report.candidate_state;
        report.apply_candidate_state = waitR.prView ? prViewStateString(waitR.prView) : report.apply_candidate_state;
        report.safe_to_continue = "YES";
      } else {
        report.apply_stopped_reason = waitR.message === "ci_wait_timeout" ? "ci_wait_timeout" : "ci_poll_failed";
        report.safe_to_continue = "NO";
      }
      exitApplyZero(report);
      return;
    }
    curPrView = waitR.prView;
    const diffAfter = listChangedPathsFromGhNameOnly(prNumber);
    if (!diffAfter.ok) {
      report.apply_stopped_reason = `gates_failed:${diffAfter.message}`;
      report.safe_to_continue = "NO";
      exitApplyZero(report);
      return;
    }
    curPaths = diffAfter.paths;
    evalResult = evaluateCandidate(curPrView, curPaths, {
      governanceCategory,
      triageCategory,
    });
    Object.assign(report, {
      candidate_files: evalResult.candidate_files,
      merge_state_status: evalResult.merge_state_status,
      mergeable: evalResult.mergeable,
      status_checks_summary: evalResult.status_checks_summary,
      risk_level: evalResult.risk_level,
      allowed_action: evalResult.allowed_action,
      blocked_reason: evalResult.blocked_reason,
      would_merge: evalResult.would_merge,
      would_push: evalResult.would_push,
      engine_changed: evalResult.engine_changed,
      assets_app_changed: evalResult.assets_app_changed,
      recommended_next_command: evalResult.recommended_next_command,
      candidate_state: prViewStateString(curPrView),
    });

    report.post_sync_merge_state_final = String(evalResult.merge_state_status || "");
    report.post_sync_mergeable_final = String(evalResult.mergeable || "");

    if (shouldPostSyncRecheckUnknownMergeState(curPrView, curPaths, evalResult)) {
      report.post_sync_recheck_attempted = "YES";
      for (let attempt = 1; attempt <= POST_SYNC_UNKNOWN_RECHECK_MAX_ATTEMPTS; attempt += 1) {
        report.post_sync_recheck_count = attempt;
        if (attempt > 1) {
          sleepMs(POST_SYNC_UNKNOWN_RECHECK_SLEEP_MS);
        }
        runCommand("gh", ["pr", "checks", String(prNumber)]);
        const recheckView = runGhJsonWithRetry([
          "pr",
          "view",
          String(prNumber),
          "--json",
          "number,title,url,headRefName,baseRefName,mergeStateStatus,mergeable,statusCheckRollup,isDraft,state",
        ]);
        if (!recheckView.ok || !recheckView.data) {
          break;
        }
        curPrView = recheckView.data;
        if (!isPrViewOpen(curPrView)) {
          break;
        }
        const diffRecheck = listChangedPathsFromGhNameOnly(prNumber);
        if (diffRecheck.ok) {
          curPaths = diffRecheck.paths;
        }
        evalResult = evaluateCandidate(curPrView, curPaths, {
          governanceCategory,
          triageCategory,
        });
        report.post_sync_merge_state_final = String(evalResult.merge_state_status || "");
        report.post_sync_mergeable_final = String(evalResult.mergeable || "");
        Object.assign(report, {
          candidate_files: evalResult.candidate_files,
          merge_state_status: evalResult.merge_state_status,
          mergeable: evalResult.mergeable,
          status_checks_summary: evalResult.status_checks_summary,
          risk_level: evalResult.risk_level,
          allowed_action: evalResult.allowed_action,
          blocked_reason: evalResult.blocked_reason,
          would_merge: evalResult.would_merge,
          would_push: evalResult.would_push,
          engine_changed: evalResult.engine_changed,
          assets_app_changed: evalResult.assets_app_changed,
          recommended_next_command: evalResult.recommended_next_command,
          candidate_state: prViewStateString(curPrView),
        });
        if (evalResult.allowed_action === "VERIFY_AND_MERGE_IF_CLEAN") {
          break;
        }
        const msLoop = String(evalResult.merge_state_status || "").toUpperCase();
        const mgLoop = String(evalResult.mergeable || "").toUpperCase();
        if (!(msLoop === "UNKNOWN" && mgLoop === "UNKNOWN")) {
          break;
        }
      }
    }

    const postSyncGates = applyUltraSafeGates(evalResult, curPrView);
    if (!postSyncGates.ok || evalResult.allowed_action !== "VERIFY_AND_MERGE_IF_CLEAN") {
      report.apply_merge_attempted = "NO";
      const msEnd = String(evalResult.merge_state_status || "").toUpperCase();
      const mgEnd = String(evalResult.mergeable || "").toUpperCase();
      const stillBothUnknown = msEnd === "UNKNOWN" && mgEnd === "UNKNOWN";
      if (report.post_sync_recheck_attempted === "YES" && stillBothUnknown) {
        report.apply_stopped_reason = "post_sync_merge_state_unknown_after_recheck";
      } else {
        report.apply_stopped_reason = "post_sync_not_merge_ready";
      }
      report.safe_to_continue = "YES";
      exitApplyZero(report);
      return;
    }
  }

  const mergeGates = reverifyMergeReady(curPrView, curPaths, evalResult);
  if (!mergeGates.ok) {
    report.apply_merge_attempted = "NO";
    if (mergeGates.reason === "pr_not_open") {
      report.apply_stopped_reason = "pr_not_open";
      report.safe_to_continue = "YES";
    } else {
      report.apply_stopped_reason = `pre_merge_reverify_failed:${mergeGates.reason}`;
      report.safe_to_continue = "NO";
    }
    exitApplyZero(report);
    return;
  }

  const preMergeOpen = runGhJsonWithRetry([
    "pr",
    "view",
    String(prNumber),
    "--json",
    "number,state,title,url,headRefName,baseRefName,mergeStateStatus,mergeable,statusCheckRollup,isDraft",
  ]);
  if (!preMergeOpen.ok || !preMergeOpen.data) {
    report.apply_merge_attempted = "NO";
    report.apply_stopped_reason = "pre_merge_gh_pr_view_failed";
    report.safe_to_continue = "NO";
    exitApplyZero(report);
    return;
  }
  if (!isPrViewOpen(preMergeOpen.data)) {
    report.apply_merge_attempted = "NO";
    report.apply_stopped_reason = "pr_not_open";
    report.candidate_state = prViewStateString(preMergeOpen.data);
    report.apply_candidate_state = prViewStateString(preMergeOpen.data);
    curPrView = preMergeOpen.data;
    report.safe_to_continue = "YES";
    exitApplyZero(report);
    return;
  }
  curPrView = preMergeOpen.data;
  report.candidate_state = prViewStateString(curPrView);
  report.apply_candidate_state = prViewStateString(curPrView);

  report.apply_merge_attempted = "YES";
  const mergeR = runCommand("gh", ["pr", "merge", String(prNumber), "--squash", "--delete-branch"]);
  if (!mergeR.ok) {
    report.apply_merge_result = "FAIL";
    report.apply_stopped_reason = "merge_failed";
    report.safe_to_continue = "NO";
    exitApplyZero(report);
    return;
  }
  report.apply_merge_result = "PASS";

  const co = runCommand("git", ["checkout", "main"]);
  if (!co.ok) {
    report.apply_post_merge_proof = "FAIL";
    report.apply_stopped_reason = "post_merge_checkout_failed";
    report.safe_to_continue = "NO";
    exitApplyZero(report);
    return;
  }
  const pull = runCommand("git", ["pull", "--ff-only"]);
  if (!pull.ok) {
    report.apply_post_merge_proof = "FAIL";
    report.apply_stopped_reason = "post_merge_pull_failed";
    report.safe_to_continue = "NO";
    exitApplyZero(report);
    return;
  }

  const dryChild = runNodeOrchestratorDryRun();
  const apChild = runSilverAutopilotStatus();
  const smokeChild = runNpmSmoke();
  const proofOk = dryChild.ok && apChild.ok && smokeChild.ok;
  report.apply_post_merge_proof = proofOk ? "PASS" : "FAIL";
  if (!proofOk) {
    report.apply_stopped_reason = "post_merge_proof_failed";
    report.safe_to_continue = "NO";
    exitApplyZero(report);
    return;
  }

  report.apply_stopped_reason = "completed_ok";
  report.safe_to_continue = "YES";
  const headAfter = runCommand("git", ["rev-parse", "HEAD"]);
  if (headAfter.ok) report.main_commit = headAfter.stdout.trim();
  exitApplyZero(report);
}

/**
 * Bounded queue: spawns child `node ... --apply-one-safe-pr` up to queueMax times (1..5).
 * Parent only enforces worktree hygiene + post-cycle guards; each child performs full apply flow.
 */
function runApplySafeQueueMain(ctx, mainCommitAtStart, queueMax) {
  const exe = process.execPath;
  const scriptPath = path.join(__dirname, "silver-pr-orchestrator-v1.cjs");

  function buildFinalRep(childSnapshot, patch) {
    const rep = { ...baseReport(), ...(childSnapshot || {}), ...patch };
    rep.generatedAt = new Date().toISOString();
    rep.mode = "APPLY_SAFE_QUEUE_V1";
    rep.queue_mode = "APPLY_SAFE_QUEUE_V1";
    rep.queue_max = queueMax;
    rep.git_status_clean_before = ctx.git_status_clean_before;
    if (!rep.main_commit || !String(rep.main_commit).trim()) {
      rep.main_commit = mainCommitAtStart;
    }
    return rep;
  }

  let lastChild = null;

  for (let cycle = 0; cycle < queueMax; cycle += 1) {
    const pre = ensureStrictCleanOrRestoreOrchestratorReportOnly();
    if (!pre.ok) {
      const rep = buildFinalRep(lastChild, {
        queue_cycles_completed: cycle,
        queue_stop_reason: `precycle_${pre.message}`,
        queue_safe_to_continue: "NO",
        error: "YES",
        error_stage: "apply_safe_queue_precycle",
        error_message: pre.message,
        blocked_reason: pre.message,
        allowed_action: "STOP_FAIL",
        dry_run_no_push_merge: "NO",
        branch_isolation_gh_only: "NO",
      });
      writeApplyPassReport(rep);
      console.error(pre.message);
      process.exit(1);
    }
    const pathsPre = parsePorcelainPaths(pre.porcelain);
    if (porcelainHasSilverRuntimeMd(pathsPre)) {
      const rep = buildFinalRep(lastChild, {
        queue_cycles_completed: cycle,
        queue_stop_reason: "precycle_runtime_silver_md",
        queue_safe_to_continue: "NO",
        error: "YES",
        error_stage: "apply_safe_queue_precycle",
        error_message: "SILVER_*.md in porcelain",
        blocked_reason: "runtime_silver_md_in_porcelain",
        allowed_action: "STOP_FAIL",
        dry_run_no_push_merge: "NO",
        branch_isolation_gh_only: "NO",
      });
      writeApplyPassReport(rep);
      process.exit(1);
    }

    const childRun = runCommand(exe, [scriptPath, "--apply-one-safe-pr"]);
    const parsed = readJsonFile(OUT_REPORT);
    if (!parsed.ok) {
      const rep = buildFinalRep(lastChild, {
        queue_cycles_completed: cycle + 1,
        queue_stop_reason: "orchestrator_report_read_failed",
        queue_safe_to_continue: "NO",
        error: "YES",
        error_stage: "apply_safe_queue_report",
        error_message: parsed.message,
        blocked_reason: parsed.message,
        allowed_action: "STOP_FAIL",
        dry_run_no_push_merge: "NO",
        branch_isolation_gh_only: "NO",
      });
      writeApplyPassReport(rep);
      console.error(parsed.message);
      process.exit(1);
    }
    lastChild = parsed.data;

    if (!childRun.ok) {
      const rep = buildFinalRep(lastChild, {
        queue_cycles_completed: cycle + 1,
        queue_stop_reason: "apply_one_child_process_failed",
        queue_safe_to_continue: "NO",
        error: "YES",
        error_stage: "apply_safe_queue_child",
        error_message: childRun.message || String(childRun.exitCode),
        blocked_reason: childRun.message || "child_process_failed",
        allowed_action: "STOP_FAIL",
        dry_run_no_push_merge: "NO",
        branch_isolation_gh_only: "NO",
      });
      writeApplyPassReport(rep);
      console.error(childRun.message || "child_process_failed");
      process.exit(1);
    }

    if (String(lastChild.error || "") === "YES") {
      const rep = buildFinalRep(lastChild, {
        queue_cycles_completed: cycle + 1,
        queue_stop_reason: "apply_one_report_error_yes",
        queue_safe_to_continue: "NO",
        dry_run_no_push_merge: "NO",
        branch_isolation_gh_only: "NO",
      });
      writeApplyPassReport(rep);
      process.exit(1);
    }

    const pg = postCycleQueueGuards();
    if (!pg.ok) {
      const rep = buildFinalRep(lastChild, {
        queue_cycles_completed: cycle + 1,
        queue_stop_reason: `post_cycle_${pg.reason}`,
        queue_safe_to_continue: "NO",
        error: "YES",
        error_stage: "apply_safe_queue_post_cycle",
        error_message: pg.detail || pg.reason,
        blocked_reason: pg.reason,
        allowed_action: "STOP_FAIL",
        dry_run_no_push_merge: "NO",
        branch_isolation_gh_only: "NO",
      });
      writeApplyPassReport(rep);
      console.error(pg.reason);
      process.exit(1);
    }

    if (String(lastChild.safe_to_continue || "") === "NO") {
      const rep = buildFinalRep(lastChild, {
        queue_cycles_completed: cycle + 1,
        queue_stop_reason: String(lastChild.apply_stopped_reason || "safe_to_continue_no"),
        queue_safe_to_continue: "NO",
        dry_run_no_push_merge: "NO",
        branch_isolation_gh_only: "NO",
      });
      writeApplyPassReport(rep);
      process.exit(1);
    }

    const sr = String(lastChild.apply_stopped_reason || "");
    if (sr === "no_safe_candidate") {
      const rep = buildFinalRep(lastChild, {
        queue_cycles_completed: cycle + 1,
        queue_stop_reason: "no_safe_candidate",
        queue_safe_to_continue: "YES",
        safe_to_continue: "YES",
        error: "NO",
        dry_run_no_push_merge: "NO",
        branch_isolation_gh_only: "NO",
      });
      writeApplyPassReport(rep);
      process.exit(0);
    }

    if (sr === "completed_ok") {
      if (cycle === queueMax - 1) {
        const rep = buildFinalRep(lastChild, {
          queue_cycles_completed: cycle + 1,
          queue_stop_reason: "queue_max_reached",
          queue_safe_to_continue: "YES",
          safe_to_continue: "YES",
          error: "NO",
          dry_run_no_push_merge: "NO",
          branch_isolation_gh_only: "NO",
        });
        writeApplyPassReport(rep);
        process.exit(0);
      }
      continue;
    }

    const rep = buildFinalRep(lastChild, {
      queue_cycles_completed: cycle + 1,
      queue_stop_reason: sr || "apply_stopped_non_merge",
      queue_safe_to_continue: "YES",
      safe_to_continue: String(lastChild.safe_to_continue || "YES"),
      error: "NO",
      dry_run_no_push_merge: "NO",
      branch_isolation_gh_only: "NO",
    });
    writeApplyPassReport(rep);
    process.exit(0);
  }
}

function queuePrecheckFailureExtras(applyQueue, queueMax, stopReason) {
  if (!applyQueue) return {};
  return {
    mode: "APPLY_SAFE_QUEUE_V1",
    queue_mode: "APPLY_SAFE_QUEUE_V1",
    queue_max: queueMax,
    queue_cycles_completed: 0,
    queue_stop_reason: stopReason || "precheck_worktree_not_clean",
    queue_safe_to_continue: "NO",
  };
}

function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry-run");
  const applyOne = argv.includes("--apply-one-safe-pr");
  const applyQueue = argv.includes("--apply-safe-queue");
  const forbidden = argv.some((a) => a === "--apply" || a.startsWith("--apply="));

  const maxArgv = argv.filter((a) => a.startsWith("--max="));
  let queueMax = null;
  if (maxArgv.length === 1) {
    const raw = maxArgv[0].slice("--max=".length);
    if (!/^\d+$/.test(raw) || String(parseInt(raw, 10)) !== raw) {
      argvUsageError();
    }
    const n = parseInt(raw, 10);
    if (n < 1 || n > 5) {
      argvUsageError();
    }
    queueMax = n;
  } else if (maxArgv.length > 1) {
    argvUsageError();
  }

  const allowedFlags = new Set(["--dry-run", "--apply-one-safe-pr", "--apply-safe-queue"]);
  const unknown = argv.filter((a) => !allowedFlags.has(a) && !/^--max=\d+$/.test(a));

  const modeCount = (dry ? 1 : 0) + (applyOne ? 1 : 0) + (applyQueue ? 1 : 0);
  if (forbidden || unknown.length > 0 || modeCount !== 1) {
    argvUsageError();
  }
  if (applyQueue && queueMax === null) {
    argvUsageError();
  }
  if (!applyQueue && maxArgv.length > 0) {
    argvUsageError();
  }

  const ctx = { git_status_clean_before: "NO" };

  let gsBefore = gitPorcelain();
  if (!gsBefore.ok) {
    exitWithErrorReport(
      ctx,
      "git_status",
      gsBefore.err || "git_status_failed",
      "GIT_STATUS_FAILED",
      { git_status_clean_before: "NO", git_status_clean_after: "NO" },
      false,
    );
  }

  if ((applyOne || applyQueue) && !isStrictCleanPorcelain(gsBefore.text)) {
    if (!isCleanAfterOrchestratorRun(gsBefore.text)) {
      exitWithErrorReport(
        ctx,
        "precheck",
        "WORKTREE_NOT_CLEAN",
        "WORKTREE_NOT_CLEAN",
        {
          git_status_clean_before: "NO",
          git_status_clean_after: "NO",
          ...queuePrecheckFailureExtras(applyQueue, queueMax, "precheck_worktree_not_clean"),
        },
        false,
      );
    }
    const restoreR = runCommand("git", ["restore", "--", OUT_REPORT_REL]);
    if (!restoreR.ok) {
      exitWithErrorReport(
        ctx,
        "precheck",
        restoreR.message || "git_restore_orchestrator_report_failed",
        "ORCHESTRATOR_REPORT_RESTORE_FAILED",
        {
          git_status_clean_before: "NO",
          git_status_clean_after: "NO",
          ...queuePrecheckFailureExtras(applyQueue, queueMax, "precheck_orchestrator_report_restore_failed"),
        },
        false,
      );
    }
    gsBefore = gitPorcelain();
    if (!gsBefore.ok || !isStrictCleanPorcelain(gsBefore.text)) {
      exitWithErrorReport(
        ctx,
        "precheck",
        "WORKTREE_NOT_CLEAN",
        "WORKTREE_NOT_CLEAN",
        {
          git_status_clean_before: "NO",
          git_status_clean_after: "NO",
          ...queuePrecheckFailureExtras(applyQueue, queueMax, "precheck_worktree_still_dirty_after_restore"),
        },
        false,
      );
    }
  }

  ctx.git_status_clean_before = isStrictCleanPorcelain(gsBefore.text) ? "YES" : "NO";
  if (!isStrictCleanPorcelain(gsBefore.text)) {
    exitWithErrorReport(
      ctx,
      "precheck",
      "WORKTREE_NOT_CLEAN",
      "WORKTREE_NOT_CLEAN",
      {
        git_status_clean_before: "NO",
        git_status_clean_after: "NO",
        ...queuePrecheckFailureExtras(applyQueue, queueMax, "precheck_worktree_not_clean"),
      },
      false,
    );
  }

  const headR = runCommand("git", ["rev-parse", "HEAD"]);
  if (!headR.ok) {
    exitWithErrorReport(
      ctx,
      "git_head",
      headR.message || "git_rev_parse_failed",
      headR.message || "git_rev_parse_failed",
      { main_commit: "", git_status_clean_before: ctx.git_status_clean_before },
      true,
    );
  }
  const mainCommit = headR.stdout.trim();

  if (applyQueue) {
    runApplySafeQueueMain(ctx, mainCommit, queueMax);
    return;
  }

  const gov = readJsonFile(GOVERNANCE_JSON);
  if (!gov.ok) {
    exitWithErrorReport(
      ctx,
      "governance_json",
      gov.message,
      gov.message,
      { main_commit: mainCommit, governance_loaded: false, git_status_clean_before: ctx.git_status_clean_before },
      true,
    );
  }

  const tri = readJsonFile(TRIAGE_JSON);
  if (!tri.ok) {
    exitWithErrorReport(
      ctx,
      "triage_json",
      tri.message,
      tri.message,
      {
        main_commit: mainCommit,
        governance_loaded: true,
        governance_total_open_prs: gov.data && gov.data.total_open_prs != null ? gov.data.total_open_prs : null,
        triage_loaded: false,
        git_status_clean_before: ctx.git_status_clean_before,
      },
      true,
    );
  }

  const governance = gov.data;
  const triage = tri.data;

  const openList = listOpenPrNumbersFromGh();
  if (!openList.ok) {
    exitWithErrorReport(
      ctx,
      "gh_pr_list_open",
      openList.message,
      openList.message,
      {
        main_commit: mainCommit,
        governance_loaded: true,
        triage_loaded: true,
        governance_total_open_prs: governance.total_open_prs,
        git_status_clean_before: ctx.git_status_clean_before,
      },
      true,
    );
  }

  const scan = scanOpenPrSafePool(governance, triage, openList.numbers);
  if (!scan.ok) {
    exitWithErrorReport(
      ctx,
      "open_pr_safe_pool_scan",
      scan.message,
      scan.message,
      {
        main_commit: mainCommit,
        governance_loaded: true,
        triage_loaded: true,
        governance_total_open_prs: governance.total_open_prs,
        total_open_prs: openList.numbers.length,
        safe_open_candidates: scan.safeCount,
        git_status_clean_before: ctx.git_status_clean_before,
      },
      true,
    );
  }

  const openPoolMeta = {
    total_open_prs: openList.numbers.length,
    safe_open_candidates: scan.safeCount,
    recommended_first_safe_candidate: scan.firstPick ? scan.firstPick.prNumber : null,
    recommended_first_safe_candidate_state: scan.firstPick ? prViewStateString(scan.firstPick.prView) : "",
    open_backlog_refresh: "YES",
    open_pr_filter_active: "YES",
  };

  if (applyOne) {
    if (!scan.firstPick) {
      const rep = {
        ...baseReport(),
        generatedAt: new Date().toISOString(),
        mode: "APPLY_ONE_SAFE_PR",
        main_commit: mainCommit,
        governance_loaded: true,
        triage_loaded: true,
        governance_total_open_prs: governance.total_open_prs,
        total_open_prs: openPoolMeta.total_open_prs,
        safe_open_candidates: openPoolMeta.safe_open_candidates,
        recommended_first_safe_candidate: null,
        recommended_first_safe_candidate_state: "",
        open_backlog_refresh: "YES",
        open_pr_filter_active: "YES",
        apply_mode: "YES",
        apply_candidate_pr: null,
        apply_sync_attempted: "NO",
        apply_sync_result: "NOT_RUN",
        apply_merge_attempted: "NO",
        apply_merge_result: "NOT_RUN",
        apply_post_merge_proof: "NOT_RUN",
        apply_stopped_reason: "no_safe_candidate",
        safe_to_continue: "YES",
        git_status_clean_before: ctx.git_status_clean_before,
        recommended_next_command: "node scripts/silver-pr-orchestrator-v1.cjs --dry-run",
        error: "NO",
        candidate_pr: null,
        candidate_state: "",
        allowed_action: "no_safe_candidate",
        blocked_reason: "no_safe_open_ultra_apply_candidate",
        dry_run_no_push_merge: "NO",
        branch_isolation_gh_only: "NO",
      };
      exitApplyZero(rep);
      return;
    }
    const fp = scan.firstPick;
    runApplyOneSafePrMain(
      ctx,
      mainCommit,
      governance,
      triage,
      fp.prNumber,
      fp.triageCategory,
      fp.governanceCategory,
      fp.prView,
      fp.diffPaths,
      openPoolMeta,
    );
  } else if (!scan.firstPick) {
    runDryRunNoSafeOpenCandidate(
      ctx,
      mainCommit,
      governance,
      triage,
      openList.numbers.length,
      scan.safeCount,
    );
  } else {
    const fp = scan.firstPick;
    runDryRunMain(
      ctx,
      mainCommit,
      governance,
      triage,
      fp.prNumber,
      fp.triageCategory,
      fp.governanceCategory,
      fp.prView,
      fp.diffPaths,
      openPoolMeta,
    );
  }
}

try {
  main();
} catch (e) {
  const msg = String((e && e.stderr) || e.message || e || "unexpected_error");
  exitWithErrorReport(
    { git_status_clean_before: "NO" },
    "unexpected",
    msg,
    msg,
    {},
    true,
  );
}
