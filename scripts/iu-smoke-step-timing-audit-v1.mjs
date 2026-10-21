#!/usr/bin/env node
/** Audit GHA smoke job step durations (measured). Usage: node scripts/iu-smoke-step-timing-audit-v1.mjs <runId> [jobName] */
import { execSync } from "child_process";

const runId = process.argv[2];
const jobName = process.argv[3] || "smoke";
if (!runId) {
  console.error("usage: node scripts/iu-smoke-step-timing-audit-v1.mjs <runId> [jobName]");
  process.exit(2);
}
const raw = execSync(`gh api repos/Josefjosefjosef/filtr/actions/runs/${runId}/jobs`, { encoding: "utf8" });
const jobs = JSON.parse(raw).jobs || [];
const job = jobs.find((j) => j.name === jobName);
if (!job) {
  console.error("job not found");
  process.exit(1);
}
const steps = (job.steps || []).map((s) => {
  const a = s.started_at ? Date.parse(s.started_at) : NaN;
  const b = s.completed_at ? Date.parse(s.completed_at) : NaN;
  const sec = Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 1000) : null;
  return { name: s.name, sec, conclusion: s.conclusion };
});
const withSec = steps.filter((s) => s.sec != null && s.sec > 0);
withSec.sort((x, y) => y.sec - x.sec);
const setup = withSec.filter((s) =>
  /checkout|setup-node|npm ci|playwright|cache/i.test(s.name)
);
console.log(
  JSON.stringify(
    {
      IU_SMOKE_STEP_TIMING: "OK",
      runId,
      headSha: job.head_sha,
      jobSec:
        job.started_at && job.completed_at
          ? Math.round((Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000)
          : null,
      setupSteps: setup,
      top40: withSec.slice(0, 40),
    },
    null,
    0
  )
);
