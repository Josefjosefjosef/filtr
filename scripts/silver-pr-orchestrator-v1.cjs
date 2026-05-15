#!/usr/bin/env node
/**
 * Silver PR Orchestrator V1 — DRY-RUN only (no merge, push, sync, branch switch).
 * Reads backlog governance + needs-sync triage JSON, picks recommended candidate,
 * refreshes PR state via gh CLI, writes silver-pr-orchestrator-v1-report.json.
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

function sleepMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* ignore */
  }
}

function runGhJson(args) {
  const maxAttempts = 5;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const out = execFileSync("gh", args, {
        cwd: REPO,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return JSON.parse(out);
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.stderr) || e.message || e || "");
      const retryable = /502|503|504|timeout|ECONNRESET|ETIMEDOUT|rate limit/i.test(msg);
      if (!retryable || attempt === maxAttempts) throw e;
      sleepMs(800 * attempt);
    }
  }
  throw lastErr || new Error("gh JSON call failed");
}

function readJsonRequired(abs) {
  const raw = fs.readFileSync(abs, "utf8");
  return JSON.parse(raw);
}

function gitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO,
    encoding: "utf8",
  }).trim();
}

function normalizePath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

function listChangedPathsFromGhFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.map((f) => normalizePath(f && f.path)).filter(Boolean);
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

function evaluateCandidate(prView, triageCandidate) {
  const paths = listChangedPathsFromGhFiles(prView.files);
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

  return {
    ...base,
    risk_level: "UNKNOWN",
    allowed_action: "STOP_UNKNOWN",
    blocked_reason: "unclassified_paths_or_merge_state",
    recommended_next_command: `gh pr view ${prView.number} --web`,
  };
}

function safeToEnableApply(evalResult) {
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

function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry-run");
  if (!dry || argv.some((a) => a === "--apply")) {
    console.error("Usage: node scripts/silver-pr-orchestrator-v1.cjs --dry-run");
    process.exit(2);
  }

  const governance = readJsonRequired(GOVERNANCE_JSON);
  const triage = readJsonRequired(TRIAGE_JSON);
  const mainCommit = gitHead();

  const rec = triage.recommended_first_sync_candidate;
  if (!rec || typeof rec.number !== "number") {
    throw new Error("triage JSON missing recommended_first_sync_candidate.number");
  }

  const prNumber = rec.number;
  const triageCategory = String(rec.triageCategory || rec.category || "UNKNOWN");

  const prView = runGhJson([
    "pr",
    "view",
    String(prNumber),
    "--json",
    "number,title,url,headRefName,baseRefName,mergeStateStatus,mergeable,files,statusCheckRollup,isDraft",
  ]);

  const evalResult = evaluateCandidate(prView, rec);

  let governanceCategory = "";
  if (Array.isArray(governance.top_needs_sync)) {
    const hit = governance.top_needs_sync.find((p) => p && p.number === prNumber);
    if (hit && hit.category) governanceCategory = String(hit.category);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: "DRY_RUN",
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
    governance_category: governanceCategory || null,
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
    safe_to_enable_apply_mode: safeToEnableApply(evalResult),
    recommended_next_command: evalResult.recommended_next_command,
  };

  fs.writeFileSync(OUT_REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path.relative(REPO, OUT_REPORT)}`);
}

try {
  main();
} catch (e) {
  const msg = String((e && e.stderr) || e.message || e || "error");
  console.error(msg);
  process.exit(1);
}
