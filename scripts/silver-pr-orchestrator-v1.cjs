#!/usr/bin/env node
/**
 * Silver PR Orchestrator V1 — DRY-RUN only (no merge, push, sync, branch switch).
 * Uses frozen backlog JSON + GitHub CLI (gh pr view, gh pr diff --name-only).
 * Never checks out PR branches or mutates git remotes in DRY-RUN.
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
    main_commit: "",
    governance_loaded: false,
    triage_loaded: false,
    governance_total_open_prs: null,
    candidate_pr: null,
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
      recommended_next_command: `gh pr sync ${prView.number}`,
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
      recommended_next_command: `gh pr sync ${prView.number}`,
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
      recommended_next_command: `gh pr sync ${prView.number}`,
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
  if (a === "STOP_HIGH_RISK" || a === "STOP_CONFLICTING" || a === "STOP_PENDING" || a === "STOP_FAIL") {
    return "NO";
  }
  if (a === "STOP_UNKNOWN") return "NO";
  if (a === "SYNC_ONLY" || a === "VERIFY_AND_MERGE_IF_CLEAN") {
    return evalResult.risk_level === "LOW" ? "YES" : "NO";
  }
  if (a === "VERIFY_ONLY") return "NO";
  return "NO";
}

function finalizeDryRunReport(report) {
  report.mode = "DRY_RUN";
  report.would_merge = "NO";
  report.would_push = "NO";
  report.dry_run_no_push_merge = "YES";
}

function exitWithErrorReport(ctx, stage, message, blockedReason, extras, attemptMain) {
  const rep = { ...baseReport(), ...extras };
  rep.generatedAt = new Date().toISOString();
  rep.mode = "DRY_RUN";
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

function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry-run");
  if (!dry || argv.some((a) => a === "--apply")) {
    const rep = baseReport();
    rep.error = "YES";
    rep.error_stage = "argv";
    rep.error_message = "invalid_arguments";
    rep.blocked_reason = "usage_requires_dry_run_only";
    const gsA = gitPorcelain();
    rep.git_status_clean_before =
      gsA.ok && isStrictCleanPorcelain(gsA.text) ? "YES" : "NO";
    writeReportFile(rep);
    const gsB = gitPorcelain();
    rep.git_status_clean_after = gsB.ok && isCleanAfterOrchestratorRun(gsB.text) ? "YES" : "NO";
    writeReportFile(rep);
    console.error("Usage: node scripts/silver-pr-orchestrator-v1.cjs --dry-run");
    process.exit(2);
  }

  const ctx = { git_status_clean_before: "NO" };

  const gsBefore = gitPorcelain();
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

  const rec = triage.recommended_first_sync_candidate;
  if (!rec || typeof rec.number !== "number") {
    exitWithErrorReport(
      ctx,
      "triage_candidate",
      "missing recommended_first_sync_candidate.number",
      "missing recommended_first_sync_candidate.number",
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

  const prNumber = rec.number;
  const triageCategory = String(rec.triageCategory || rec.category || "UNKNOWN");

  let governanceCategory = "";
  if (Array.isArray(governance.top_needs_sync)) {
    const hit = governance.top_needs_sync.find((p) => p && p.number === prNumber);
    if (hit && hit.category) governanceCategory = String(hit.category);
  }

  const prJson = runGhJsonWithRetry([
    "pr",
    "view",
    String(prNumber),
    "--json",
    "number,title,url,headRefName,baseRefName,mergeStateStatus,mergeable,statusCheckRollup,isDraft",
  ]);
  if (!prJson.ok) {
    exitWithErrorReport(
      ctx,
      "gh_pr_view",
      prJson.message,
      prJson.message,
      {
        main_commit: mainCommit,
        governance_loaded: true,
        triage_loaded: true,
        governance_total_open_prs: governance.total_open_prs,
        candidate_pr: prNumber,
        candidate_category: triageCategory,
        git_status_clean_before: ctx.git_status_clean_before,
      },
      true,
    );
  }

  const prView = prJson.data;
  const diffPaths = listChangedPathsFromGhNameOnly(prNumber);
  if (!diffPaths.ok) {
    exitWithErrorReport(
      ctx,
      "gh_pr_diff",
      diffPaths.message,
      diffPaths.message,
      {
        main_commit: mainCommit,
        governance_loaded: true,
        triage_loaded: true,
        governance_total_open_prs: governance.total_open_prs,
        candidate_pr: prView.number,
        candidate_title: prView.title,
        candidate_url: prView.url,
        candidate_head_ref: prView.headRefName,
        candidate_base_ref: prView.baseRefName,
        candidate_category: triageCategory,
        git_status_clean_before: ctx.git_status_clean_before,
      },
      true,
    );
  }

  const evalResult = evaluateCandidate(prView, diffPaths.paths, {
    governanceCategory,
    triageCategory,
  });

  const report = {
    ...baseReport(),
    generatedAt: new Date().toISOString(),
    main_commit: mainCommit,
    governance_loaded: true,
    triage_loaded: true,
    governance_total_open_prs: governance.total_open_prs,
    candidate_pr: prView.number,
    candidate_title: prView.title,
    candidate_url: prView.url,
    candidate_head_ref: prView.headRefName,
    candidate_base_ref: prView.baseRefName,
    candidate_category: triageCategory,
    governance_category: governanceCategory.length ? governanceCategory : null,
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
