/**
 * pipeline_runtime_guard — ingest+aggregate completion must finish within SLA.
 *
 * Phase 3D-B: measures last run where ingest + aggregate jobs succeeded,
 * not workflow conclusion or release success.
 *
 * Run: node scripts/pipeline-runtime-guard.mjs
 */
import { execSync } from "child_process";
import {
  aggregateJobCompletionMs,
  classifyRunFromGitHub,
  ingestAggregateJobsSucceeded,
  isIngestAggregateOkStatus,
} from "./iu_pipeline_run_classifier.mjs";

const warnMin = Number(process.env.PIPELINE_RUNTIME_WARN_MINUTES || "45");
const failMin = Number(process.env.PIPELINE_RUNTIME_FAIL_MINUTES || "60");
const skip = String(process.env.PIPELINE_RUNTIME_SKIP || "0") === "1";
const skipOnPr = String(process.env.PIPELINE_RUNTIME_SKIP_ON_PULL_REQUEST || "1") !== "0";
const githubEvent = (process.env.GITHUB_EVENT_NAME || "").trim();
const repo = process.env.GITHUB_REPOSITORY || "";
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

function log(msg) {
  console.log(`[pipeline-runtime-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[pipeline-runtime-guard] FAIL: ${msg}`);
}

async function main() {
  if (skip || !token || !repo) {
    log("SKIP no GITHUB_TOKEN/repository");
    log("RESULT=PASS");
    return;
  }

  if (skipOnPr && githubEvent === "pull_request") {
    log("SKIP on pull_request (post-merge runtime proof on main)");
    log("RESULT=PASS");
    return;
  }

  let json;
  try {
    const out = execSync(
      `gh run list --workflow update-articles.yml --repo ${repo} --limit 15 --json databaseId,status,conclusion,createdAt,updatedAt`,
      { encoding: "utf8", env: { ...process.env, GH_TOKEN: token } },
    );
    json = JSON.parse(out);
  } catch (e) {
    log(`WARN gh run list failed: ${e.message || e}`);
    log("RESULT=PASS_WITH_WARN");
    return;
  }

  const [owner, repoName] = repo.split("/");
  const completed = (json || []).filter((r) => r.status === "completed");

  for (const run of completed) {
    let classified;
    try {
      classified = await classifyRunFromGitHub(owner, repoName, run, token, { fetchArtifact: false });
    } catch (e) {
      log(`WARN classify run_id=${run.databaseId} ${e instanceof Error ? e.message : e}`);
      continue;
    }

    if (!ingestAggregateJobsSucceeded(classified.jobs)) {
      if (isIngestAggregateOkStatus(classified.overall)) {
        log(`WARN run_id=${run.databaseId} overall=${classified.overall} but jobs missing (legacy)`);
      }
      continue;
    }

    const runtimeMs = aggregateJobCompletionMs(classified.jobs, run.createdAt);
    if (runtimeMs == null) {
      const start = Date.parse(run.createdAt);
      const end = Date.parse(run.updatedAt);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const runtimeMin = (end - start) / 60_000;
      log(
        `last_ingest_aggregate_ok run_id=${run.databaseId} overall=${classified.overall} runtime_min=${runtimeMin.toFixed(1)} (run_wall_clock_fallback)`,
      );
      if (runtimeMin > failMin) {
        fail(`runtime ${runtimeMin.toFixed(1)}m > ${failMin}m`);
        console.error("[pipeline-runtime-guard] RESULT=FAIL");
        process.exit(1);
      }
      if (runtimeMin > warnMin) {
        log(`WARN: runtime ${runtimeMin.toFixed(1)}m > ${warnMin}m`);
        log("RESULT=PASS_WITH_WARN");
        return;
      }
      log("RESULT=PASS");
      return;
    }

    const runtimeMin = runtimeMs / 60_000;
    log(
      `last_ingest_aggregate_ok run_id=${run.databaseId} overall=${classified.overall} runtime_min=${runtimeMin.toFixed(1)}`,
    );

    if (runtimeMin > failMin) {
      fail(`runtime ${runtimeMin.toFixed(1)}m > ${failMin}m`);
      console.error("[pipeline-runtime-guard] RESULT=FAIL");
      process.exit(1);
    }
    if (runtimeMin > warnMin) {
      log(`WARN: runtime ${runtimeMin.toFixed(1)}m > ${warnMin}m`);
      log("RESULT=PASS_WITH_WARN");
      return;
    }
    log("RESULT=PASS");
    return;
  }

  log("WARN no recent completed run with ingest+aggregate job success");
  log("RESULT=PASS_WITH_WARN");
}

main().catch((e) => {
  fail(e.message || String(e));
  process.exit(1);
});
