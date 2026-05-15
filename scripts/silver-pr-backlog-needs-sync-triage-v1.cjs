#!/usr/bin/env node
/**
 * Silver PR backlog NEEDS_REBASE_OR_SYNC triage V1 — scripts-only.
 * Reads fixed PR list via gh CLI, classifies sync risk, writes JSON report.
 * No merges, no closes, no branch switches, no engine edits.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "silver-pr-backlog-needs-sync-triage-v1-report.json");

const TARGET_PRS = [339, 159, 549, 669, 877, 1205, 1251, 1693, 1702];

const CATEGORIES = [
  "SYNC_SAFE_LOW_RISK",
  "SYNC_SAFE_INFRA_ONLY",
  "SYNC_RISK_DATA_ONLY",
  "SYNC_RISK_ASSETS_APP_JS",
  "SYNC_RISK_WORKFLOW",
  "SYNC_RISK_MANY_FILES",
  "SYNC_NOT_RECOMMENDED_STALE",
  "SYNC_UNKNOWN_MANUAL_REVIEW",
];

const STALE_DAYS_SINCE_UPDATE = 90;
const MANY_FILES_THRESHOLD = 10;
const MS_PER_DAY = 86400000;

const STALE_TITLE_RE = /\b(wip|obsolete|deprecated|stall|stale|abandon|do\s*not\s*merge|\bdnm\b)\b/i;

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

function hasGithubWorkflow(paths) {
  return paths.some((p) => p.startsWith(".github/workflows/"));
}

function isOnlyProjectsData(paths) {
  if (!paths.length) return false;
  return paths.every((p) => /^projects\/data\//.test(p));
}

function isOnlyScripts(paths) {
  if (!paths.length) return false;
  return paths.every((p) => /^scripts\//.test(p));
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

function daysSince(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return (Date.now() - t) / MS_PER_DAY;
}

function isStale(pr) {
  const title = String(pr.title || "");
  if (STALE_TITLE_RE.test(title)) return true;
  if (daysSince(pr.updatedAt) >= STALE_DAYS_SINCE_UPDATE) return true;
  return false;
}

function classifySyncTriage(paths, pr) {
  const riskFlags = [];
  if (hasAssetsAppJs(paths)) riskFlags.push("touches_assets_app_js");
  if (hasGithubWorkflow(paths)) riskFlags.push("touches_github_workflows");
  if (isOnlyProjectsData(paths)) riskFlags.push("projects_data_only");
  if (paths.length > MANY_FILES_THRESHOLD) riskFlags.push("many_changed_files");
  if (isStale(pr)) riskFlags.push("stale_or_stale_title");
  if (isOnlyScripts(paths)) riskFlags.push("scripts_only_paths");
  if (paths.length === 0) riskFlags.push("no_changed_files_listed");

  if (hasAssetsAppJs(paths)) {
    return { category: "SYNC_RISK_ASSETS_APP_JS", riskFlags };
  }
  if (hasGithubWorkflow(paths)) {
    return { category: "SYNC_RISK_WORKFLOW", riskFlags };
  }
  if (isOnlyProjectsData(paths)) {
    return { category: "SYNC_RISK_DATA_ONLY", riskFlags };
  }
  if (paths.length > MANY_FILES_THRESHOLD) {
    return { category: "SYNC_RISK_MANY_FILES", riskFlags };
  }
  if (isStale(pr)) {
    return { category: "SYNC_NOT_RECOMMENDED_STALE", riskFlags };
  }
  if (isOnlyScripts(paths)) {
    return { category: "SYNC_SAFE_INFRA_ONLY", riskFlags };
  }
  if (
    paths.length > 0 &&
    paths.length <= MANY_FILES_THRESHOLD &&
    !touchesEngineishPath(paths)
  ) {
    return { category: "SYNC_SAFE_LOW_RISK", riskFlags };
  }
  return { category: "SYNC_UNKNOWN_MANUAL_REVIEW", riskFlags };
}

function emptyCounts() {
  const o = {};
  for (const c of CATEGORIES) o[c] = 0;
  return o;
}

function pickFirstSyncCandidate(rows) {
  const prefer = ["SYNC_SAFE_LOW_RISK", "SYNC_SAFE_INFRA_ONLY"];
  const scored = [];
  for (const r of rows) {
    const idx = prefer.indexOf(r.triageCategory);
    if (idx < 0) continue;
    scored.push({
      pr: r,
      pref: idx,
      nfiles: Array.isArray(r.changedFiles) ? r.changedFiles.length : 999,
      updated: Date.parse(r.updatedAt) || 0,
    });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => {
    if (a.pref !== b.pref) return a.pref - b.pref;
    if (a.nfiles !== b.nfiles) return a.nfiles - b.nfiles;
    return b.updated - a.updated;
  });
  const top = scored[0].pr;
  return {
    number: top.number,
    title: top.title,
    url: top.url,
    triageCategory: top.triageCategory,
    changedFilesCount: top.changedFiles.length,
  };
}

function recommendedNextAction(report) {
  const c = report.counts_by_category;
  const cand = report.recommended_first_sync_candidate;
  if (cand) {
    return `Prefer syncing PR #${cand.number} (${cand.triageCategory}) first: merge latest main into its branch locally or via GitHub, then run smoke; avoid batch sync for higher-risk categories until reviewed.`;
  }
  if (c.SYNC_RISK_DATA_ONLY > 0) {
    return "No SYNC_SAFE_* candidates; review SYNC_RISK_DATA_ONLY PRs with data freshness gates before syncing.";
  }
  if (c.SYNC_UNKNOWN_MANUAL_REVIEW > 0) {
    return "No safe automatic sync candidate; manually review UNKNOWN and stale PRs before updating branches.";
  }
  return "Triage complete; follow per-PR categories in the report.";
}

function fetchPr(num) {
  const fields = [
    "number",
    "title",
    "url",
    "headRefName",
    "baseRefName",
    "mergeStateStatus",
    "mergeable",
    "createdAt",
    "updatedAt",
    "files",
    "statusCheckRollup",
    "isDraft",
  ].join(",");

  return runGhJson(["pr", "view", String(num), "--json", fields]);
}

function main() {
  let mainCommit = "";
  try {
    mainCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO,
      encoding: "utf8",
    }).trim();
  } catch {
    mainCommit = "";
  }

  const rows = [];
  for (const num of TARGET_PRS) {
    const pr = fetchPr(num);
    const paths = listChangedPaths(pr.files);
    const checkSummary = summarizeChecks(pr.statusCheckRollup);
    const { category, riskFlags } = classifySyncTriage(paths, pr);

    rows.push({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      mergeStateStatus: pr.mergeStateStatus,
      mergeable: pr.mergeable,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      isDraft: Boolean(pr.isDraft),
      changedFiles: paths,
      changedFilesCount: paths.length,
      statusChecksSummary: checkSummary,
      riskFlags,
      triageCategory: category,
    });
  }

  const counts = emptyCounts();
  for (const r of rows) {
    if (counts[r.triageCategory] !== undefined) counts[r.triageCategory] += 1;
  }

  const byCat = (cat) => rows.filter((r) => r.triageCategory === cat);

  const report = {
    generatedAt: new Date().toISOString(),
    main_commit: mainCommit,
    total_target_prs: rows.length,
    counts_by_category: counts,
    sync_safe_low_risk: byCat("SYNC_SAFE_LOW_RISK"),
    sync_safe_infra_only: byCat("SYNC_SAFE_INFRA_ONLY"),
    sync_risk_data_only: byCat("SYNC_RISK_DATA_ONLY"),
    sync_risk_assets_app_js: byCat("SYNC_RISK_ASSETS_APP_JS"),
    sync_risk_workflow: byCat("SYNC_RISK_WORKFLOW"),
    sync_risk_many_files: byCat("SYNC_RISK_MANY_FILES"),
    sync_not_recommended_stale: byCat("SYNC_NOT_RECOMMENDED_STALE"),
    sync_unknown_manual_review: byCat("SYNC_UNKNOWN_MANUAL_REVIEW"),
    recommended_first_sync_candidate: pickFirstSyncCandidate(rows),
    recommended_next_action: "",
    prs: rows,
  };

  report.recommended_next_action = recommendedNextAction(report);

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
  console.log("Wrote", path.relative(REPO, OUT), "prs=", report.total_target_prs);
}

main();
