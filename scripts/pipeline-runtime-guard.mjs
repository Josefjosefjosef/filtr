/**
 * pipeline_runtime_guard — last update-articles run must finish within SLA.
 *
 * Run: node scripts/pipeline-runtime-guard.mjs
 *
 * Env:
 *   GITHUB_TOKEN, GITHUB_REPOSITORY
 *   PIPELINE_RUNTIME_WARN_MINUTES — default 10
 *   PIPELINE_RUNTIME_FAIL_MINUTES — default 12
 *   PIPELINE_RUNTIME_SKIP — 1 to skip when no token
 */
import { execSync } from "child_process";

const warnMin = Number(process.env.PIPELINE_RUNTIME_WARN_MINUTES || "10");
const failMin = Number(process.env.PIPELINE_RUNTIME_FAIL_MINUTES || "12");
const skip = String(process.env.PIPELINE_RUNTIME_SKIP || "0") === "1";
const skipOnPr = String(process.env.PIPELINE_RUNTIME_SKIP_ON_PULL_REQUEST || "1") !== "0";
const githubEvent = (process.env.GITHUB_EVENT_NAME || "").trim();
const repo = process.env.GITHUB_REPOSITORY || "";
const token = process.env.GITHUB_TOKEN || "";

function log(msg) {
  console.log(`[pipeline-runtime-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[pipeline-runtime-guard] FAIL: ${msg}`);
}

function main() {
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
      `gh run list --workflow update-articles.yml --repo ${repo} --limit 5 --json databaseId,status,conclusion,createdAt,updatedAt`,
      { encoding: "utf8", env: { ...process.env, GH_TOKEN: token } },
    );
    json = JSON.parse(out);
  } catch (e) {
    log(`WARN gh run list failed: ${e.message || e}`);
    log("RESULT=PASS_WITH_WARN");
    return;
  }

  const completed = (json || []).find((r) => r.status === "completed" && r.conclusion === "success");
  if (!completed) {
    log("WARN no recent successful update-articles run");
    log("RESULT=PASS_WITH_WARN");
    return;
  }

  const start = Date.parse(completed.createdAt);
  const end = Date.parse(completed.updatedAt);
  const runtimeMin = (end - start) / 60_000;
  log(`last_success_run=${completed.databaseId} runtime_min=${runtimeMin.toFixed(1)}`);

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
}

main();
