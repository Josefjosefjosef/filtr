#!/usr/bin/env node
/**
 * Track open PRs: CI pending / needs fix / merge-ready (required contexts only).
 * Uses GitHub CLI (gh). Does not merge or bypass branch protection.
 */
import { execSync } from "child_process";

const REQUIRED = new Set(["repo-guard", "layout-guard", "iu-ads-regression-freeze", "smoke"]);

function ghJson(args) {
  const out = execSync(`gh ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(out);
}

function rowOutcome(row) {
  if (!row) return "missing";
  const conclusion = String(row.conclusion || "").toUpperCase();
  const state = String(row.state || "").toUpperCase();
  const status = String(row.status || "").toUpperCase();
  if (conclusion === "SUCCESS" || state === "SUCCESS") return "ok";
  if (conclusion === "SKIPPED") return "ok";
  if (conclusion === "FAILURE" || conclusion === "TIMED_OUT" || state === "FAILURE") return "fail";
  if (status === "IN_PROGRESS" || status === "QUEUED" || state === "PENDING" || state === "EXPECTED") {
    return "pending";
  }
  if (!conclusion && !state) return "pending";
  if (conclusion && conclusion !== "SUCCESS") return "fail";
  return "pending";
}

function classifyRollup(rollup) {
  const byName = new Map();
  for (const row of rollup || []) {
    const name = row.name || row.context;
    if (!name) continue;
    byName.set(name, row);
  }
  let pending = 0;
  let failed = 0;
  let missing = 0;
  for (const req of REQUIRED) {
    const outcome = rowOutcome(byName.get(req));
    if (outcome === "ok") continue;
    if (outcome === "missing") missing += 1;
    else if (outcome === "fail") failed += 1;
    else pending += 1;
  }
  if (failed > 0) return "NEEDS_FIX";
  if (pending > 0 || missing > 0) return "CI_PENDING";
  return "MERGE_READY";
}

function main() {
  const prs = ghJson(
    'pr list --state open --limit 30 --json number,title,headRefOid,url,statusCheckRollup,isDraft'
  );
  const rows = [];
  for (const pr of prs) {
    if (pr.isDraft) {
      rows.push({ number: pr.number, title: pr.title, head: pr.headRefOid, url: pr.url, bucket: "DRAFT" });
      continue;
    }
    rows.push({
      number: pr.number,
      title: pr.title,
      head: pr.headRefOid,
      url: pr.url,
      bucket: classifyRollup(pr.statusCheckRollup),
    });
  }
  console.log(JSON.stringify({ IU_DEV_PR_TRACKER: "OK", at: new Date().toISOString(), prs: rows }, null, 0));
}

main();
