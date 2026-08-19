#!/usr/bin/env node
/**
 * Deterministic helper for required commit-status lifecycle.
 * Contract for workflow status steps (layout-guard / repo-guard / smoke).
 *
 * Rules:
 * - cancelled / skipped → do not post (never overwrite SUCCESS with false FAILURE)
 * - success → post success
 * - any other job status → post failure (real test fail)
 * - pull_request / pull_request_target → use pull_request.head.sha
 * - optional: skip posting failure when context is already success (stale run)
 */
import path from "path";
import { fileURLToPath } from "url";

export function resolveStatusPost({ jobStatus, githubSha, eventName, pullRequestHeadSha }) {
  const status = String(jobStatus || "");
  if (status === "cancelled" || status === "skipped") {
    return { shouldPost: false, state: null, reason: "job_" + status };
  }

  const state = status === "success" ? "success" : "failure";
  let sha = String(githubSha || "");
  if (eventName === "pull_request" || eventName === "pull_request_target") {
    const head = String(pullRequestHeadSha || "").trim();
    if (!head) {
      return { shouldPost: false, state: null, reason: "missing_pull_request_head_sha" };
    }
    sha = head;
  }
  if (!sha) {
    return { shouldPost: false, state: null, reason: "missing_sha" };
  }
  return { shouldPost: true, state, sha, reason: "post_" + state };
}

export function shouldSkipFailureOverwrite({ proposedState, existingContextState }) {
  if (proposedState !== "failure") return false;
  return existingContextState === "success";
}

export function selfTest() {
  const fails = [];
  function eq(a, b, id) {
    if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(id + " got=" + JSON.stringify(a));
  }

  eq(
    resolveStatusPost({
      jobStatus: "cancelled",
      githubSha: "aaa",
      eventName: "pull_request",
      pullRequestHeadSha: "bbb"
    }),
    { shouldPost: false, state: null, reason: "job_cancelled" },
    "cancelled_skip"
  );

  eq(
    resolveStatusPost({
      jobStatus: "skipped",
      githubSha: "aaa",
      eventName: "push",
      pullRequestHeadSha: ""
    }),
    { shouldPost: false, state: null, reason: "job_skipped" },
    "skipped_skip"
  );

  eq(
    resolveStatusPost({
      jobStatus: "success",
      githubSha: "base",
      eventName: "pull_request_target",
      pullRequestHeadSha: "headsha"
    }),
    { shouldPost: true, state: "success", sha: "headsha", reason: "post_success" },
    "prt_head_sha"
  );

  eq(
    resolveStatusPost({
      jobStatus: "failure",
      githubSha: "pushsha",
      eventName: "push",
      pullRequestHeadSha: ""
    }),
    { shouldPost: true, state: "failure", sha: "pushsha", reason: "post_failure" },
    "push_failure"
  );

  eq(shouldSkipFailureOverwrite({ proposedState: "failure", existingContextState: "success" }), true, "skip_clobber");
  eq(shouldSkipFailureOverwrite({ proposedState: "success", existingContextState: "failure" }), false, "allow_success");
  eq(shouldSkipFailureOverwrite({ proposedState: "failure", existingContextState: "failure" }), false, "allow_real_fail");

  if (fails.length) {
    console.error("[required-status-lifecycle] FAIL");
    for (let i = 0; i < fails.length; i++) console.error(fails[i]);
    process.exit(1);
  }
  console.log("[required-status-lifecycle] PASS");
  console.log("RESULT=PASS");
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(thisFile) === invoked) {
  selfTest();
}
