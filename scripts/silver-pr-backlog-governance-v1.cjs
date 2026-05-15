#!/usr/bin/env node
/**
 * Silver PR backlog governance V1 — scripts-only: reads open PRs via gh CLI,
 * classifies risk, writes JSON report. No merges, no closes, no engine edits.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "silver-pr-backlog-governance-v1-report.json");

const CATEGORIES = [
  "SAFE_TO_VERIFY_NOW",
  "NEEDS_REBASE_OR_SYNC",
  "CONFLICTING_DO_NOT_TOUCH",
  "DATA_PIPELINE_BLOCKED",
  "PRODUCT_HIGH_RISK_ASSETS_APP_JS",
  "WORKFLOW_INFRA",
  "STALE_CANDIDATE_TO_CLOSE",
  "UNKNOWN_MANUAL_REVIEW",
];

const STALE_DAYS_SINCE_UPDATE = 75;
const MS_PER_DAY = 86400000;

const AUTOPILOT_INFRA_PATHS = new Set([
  "scripts/silver-autopilot.cjs",
  "scripts/silver-autopilot-loop.ps1",
  "scripts/silver-autonomous-loop-safety-diagnostic.ps1",
]);

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
      const retryable =
        /502|503|504|timeout|ECONNRESET|ETIMEDOUT|rate limit/i.test(msg);
      if (!retryable || attempt === maxAttempts) throw e;
      sleepMs(800 * attempt);
    }
  }
  throw lastErr || new Error("gh JSON call failed");
}

function normalizePath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

function listChangedPaths(files) {
  if (!Array.isArray(files)) return [];
  return files.map((f) => normalizePath(f && f.path)).filter(Boolean);
}

function hasAssetsAppJs(paths) {
  return paths.some((p) => p === "assets/app.js" || p.endsWith("/assets/app.js"));
}

function isWorkflowInfraPath(p) {
  if (p.startsWith(".github/workflows/")) return true;
  return AUTOPILOT_INFRA_PATHS.has(p);
}

function hasWorkflowInfra(paths) {
  return paths.some(isWorkflowInfraPath);
}

function isOnlyProjectsData(paths) {
  if (!paths.length) return false;
  return paths.every((p) => /^projects\/data\//.test(p));
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
    const wf = String((c && c.workflowName) || "");
    const status = String((c && c.status) || "").toUpperCase();
    const conclusion = String((c && c.conclusion) || "").toUpperCase();
    if (status === "COMPLETED") summary.completed += 1;
    if (status === "IN_PROGRESS" || status === "QUEUED" || status === "PENDING" || status === "WAITING") {
      summary.pending += 1;
      if (name) summary.pendingNames.push(name);
      continue;
    }
    if (conclusion === "FAILURE" || conclusion === "TIMED_OUT" || conclusion === "ACTION_REQUIRED") {
      summary.failed += 1;
      if (name) summary.failedNames.push(name);
    } else if (conclusion === "SUCCESS") summary.success += 1;
    else if (conclusion === "SKIPPED") summary.skipped += 1;
    else if (conclusion === "CANCELLED") summary.cancelled += 1;
    else if (conclusion === "NEUTRAL") summary.neutral += 1;
  }
  return summary;
}

function freshnessRelatedFailed(checkSummary) {
  const re = /freshness|data\s*freshness|ci-data-freshness/i;
  for (const n of checkSummary.failedNames) {
    if (re.test(n)) return true;
  }
  return false;
}

function anyFailedChecks(checkSummary) {
  return checkSummary.failed > 0;
}

function daysSince(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return (Date.now() - t) / MS_PER_DAY;
}

function isStaleCandidate(pr, paths, checkSummary) {
  const upd = daysSince(pr.updatedAt);
  const mergeable = String(pr.mergeable || "").toUpperCase();
  if (upd >= STALE_DAYS_SINCE_UPDATE) return true;
  if (mergeable === "CONFLICTING") return true;
  if (paths.length === 0 && checkSummary.pending > 0 && upd >= 30) return true;
  return false;
}

function classifyPr(pr) {
  const paths = listChangedPaths(pr.files);
  const checkSummary = summarizeChecks(pr.statusCheckRollup);
  const mergeState = String(pr.mergeStateStatus || "").toUpperCase();
  const mergeable = String(pr.mergeable || "").toUpperCase();

  const riskFlags = [];
  if (hasAssetsAppJs(paths)) riskFlags.push("touches_assets_app_js");
  if (hasWorkflowInfra(paths)) riskFlags.push("touches_workflow_or_autopilot_infra");
  if (isOnlyProjectsData(paths)) riskFlags.push("projects_data_only");
  if (mergeState === "UNKNOWN" || mergeable === "UNKNOWN") riskFlags.push("merge_state_unknown");
  if (checkSummary.pending > 0) riskFlags.push("checks_pending");
  if (anyFailedChecks(checkSummary)) riskFlags.push("checks_failed");
  if (freshnessRelatedFailed(checkSummary)) riskFlags.push("freshness_check_failed");

  let category = "SAFE_TO_VERIFY_NOW";

  if (hasAssetsAppJs(paths)) {
    category = "PRODUCT_HIGH_RISK_ASSETS_APP_JS";
  } else if (
    mergeState === "DIRTY" ||
    mergeState === "CONFLICTING" ||
    mergeable === "CONFLICTING"
  ) {
    category = "CONFLICTING_DO_NOT_TOUCH";
  } else if (mergeState === "BEHIND") {
    category = "NEEDS_REBASE_OR_SYNC";
  } else if (hasWorkflowInfra(paths)) {
    category = "WORKFLOW_INFRA";
  } else if (isOnlyProjectsData(paths) && freshnessRelatedFailed(checkSummary)) {
    category = "DATA_PIPELINE_BLOCKED";
  } else if (
    mergeable === "UNKNOWN" ||
    mergeState === "UNKNOWN" ||
    checkSummary.pending > 0 ||
    anyFailedChecks(checkSummary)
  ) {
    category = "UNKNOWN_MANUAL_REVIEW";
  } else if (isStaleCandidate(pr, paths, checkSummary)) {
    category = "STALE_CANDIDATE_TO_CLOSE";
  } else {
    category = "SAFE_TO_VERIFY_NOW";
  }

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    mergeStateStatus: pr.mergeStateStatus,
    mergeable: pr.mergeable,
    changedFiles: paths,
    statusChecksSummary: checkSummary,
    riskFlags,
    category,
    isDraft: Boolean(pr.isDraft),
    updatedAt: pr.updatedAt,
    createdAt: pr.createdAt,
  };
}

function emptyCounts() {
  const o = {};
  for (const c of CATEGORIES) o[c] = 0;
  return o;
}

function topSlice(rows, n) {
  return rows.slice(0, n).map((r) => ({
    number: r.number,
    title: r.title,
    url: r.url,
    category: r.category,
  }));
}

function recommendedNextAction(report) {
  const c = report.counts_by_category;
  if (c.CONFLICTING_DO_NOT_TOUCH > 0) {
    return "Avoid CONFLICTING_DO_NOT_TOUCH PRs until merge state is clean; do not resolve conflicts in this governance pass.";
  }
  if (c.DATA_PIPELINE_BLOCKED > 0) {
    return "Unblock DATA_PIPELINE_BLOCKED PRs (data-only + failing freshness-related checks) before treating data merges as routine.";
  }
  if (c.NEEDS_REBASE_OR_SYNC > 0 && c.SAFE_TO_VERIFY_NOW > 0) {
    const first = report.top_safe_to_verify[0];
    const sn = first ? String(first.number) : "?";
    return `Sync or rebase NEEDS_REBASE_OR_SYNC PRs; in parallel you may verify SAFE PR #${sn} with local gates.`;
  }
  if (c.NEEDS_REBASE_OR_SYNC > 0) {
    return "Prioritize syncing or rebasing PRs behind main (NEEDS_REBASE_OR_SYNC) before full autonomous mode.";
  }
  if (c.UNKNOWN_MANUAL_REVIEW > 0) {
    return "Review UNKNOWN_MANUAL_REVIEW PRs (unknown mergeability, pending checks, or failed checks) before batch verification.";
  }
  if (c.SAFE_TO_VERIFY_NOW > 0) {
    const first = report.top_safe_to_verify[0];
    const sn = first ? String(first.number) : "?";
    return `Start backlog cleanup with SAFE_TO_VERIFY_NOW PR #${sn} using standard verify / smoke gates.`;
  }
  return "No open PRs or backlog is idle; safe to proceed with autonomous planning.";
}

function main() {
  const fields = [
    "number",
    "title",
    "url",
    "headRefName",
    "baseRefName",
    "mergeStateStatus",
    "mergeable",
    "files",
    "statusCheckRollup",
    "isDraft",
    "updatedAt",
    "createdAt",
  ].join(",");

  const raw = runGhJson([
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "500",
    "--json",
    fields,
  ]);

  if (!Array.isArray(raw)) {
    throw new Error("gh pr list: expected JSON array");
  }

  const prs = raw.map(classifyPr);
  const counts = emptyCounts();
  for (const p of prs) {
    if (counts[p.category] !== undefined) counts[p.category] += 1;
  }

  const by = (cat) => prs.filter((p) => p.category === cat);
  const sortUpdated = (a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt);

  const report = {
    generatedAt: new Date().toISOString(),
    total_open_prs: prs.length,
    counts_by_category: counts,
    top_safe_to_verify: topSlice(
      by("SAFE_TO_VERIFY_NOW").sort(sortUpdated),
      10,
    ),
    top_needs_sync: topSlice(by("NEEDS_REBASE_OR_SYNC").sort(sortUpdated), 10),
    top_conflicting: topSlice(by("CONFLICTING_DO_NOT_TOUCH").sort(sortUpdated), 10),
    top_stale_to_close: topSlice(by("STALE_CANDIDATE_TO_CLOSE").sort(sortUpdated), 10),
    data_blockers: by("DATA_PIPELINE_BLOCKED").map((r) => ({
      number: r.number,
      title: r.title,
      url: r.url,
    })),
    high_risk_product_prs: by("PRODUCT_HIGH_RISK_ASSETS_APP_JS").map((r) => ({
      number: r.number,
      title: r.title,
      url: r.url,
    })),
    workflow_infra_prs: by("WORKFLOW_INFRA").map((r) => ({
      number: r.number,
      title: r.title,
      url: r.url,
    })),
    recommended_next_action: "",
    prs,
  };

  report.recommended_next_action = recommendedNextAction(report);

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
  console.log("Wrote", path.relative(REPO, OUT), "open_prs=", report.total_open_prs);
}

main();
