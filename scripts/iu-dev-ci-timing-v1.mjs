#!/usr/bin/env node
/**
 * Print recent GitHub Actions job durations (measured, not estimated).
 * Usage: node scripts/iu-dev-ci-timing-v1.mjs [pr-number]
 */
import { execSync } from "child_process";

function ghJson(args) {
  return JSON.parse(execSync(`gh ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

function jobSeconds(job) {
  const started = job.started_at || job.startedAt;
  const completed = job.completed_at || job.completedAt;
  if (!started || !completed) return null;
  const a = Date.parse(started);
  const b = Date.parse(completed);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 1000);
}

function runsForHead(headSha) {
  const workflows = ["Smoke", "Repo guard", "Layout guard", "IU Ads regression freeze"];
  const out = [];
  for (const wf of workflows) {
    const runs = ghJson(
      `run list --workflow "${wf}" --limit 15 --json databaseId,headSha,conclusion,createdAt,updatedAt`
    );
    const hit = runs.find((r) => r.headSha === headSha);
    if (!hit) continue;
    const jobs = ghJson(`api repos/{owner}/{repo}/actions/runs/${hit.databaseId}/jobs`).jobs || [];
    out.push({
      workflow: wf,
      runId: hit.databaseId,
      conclusion: hit.conclusion,
      jobs: jobs.map((j) => ({
        name: j.name,
        conclusion: j.conclusion,
        seconds: jobSeconds(j),
      })),
    });
  }
  return out;
}

function main() {
  const prNum = process.argv[2];
  let head = process.argv[3] || "";
  if (prNum && !head) {
    const pr = ghJson(`pr view ${prNum} --json headRefOid,title,url`);
    head = pr.headRefOid;
    console.log(JSON.stringify({ pr: prNum, title: pr.title, url: pr.url, head }, null, 0));
  } else if (!head) {
    head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  }
  const timings = runsForHead(head);
  console.log(JSON.stringify({ IU_DEV_CI_TIMING: "OK", head, workflows: timings }, null, 0));
}

main();
