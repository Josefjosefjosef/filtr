/**
 * Phase 3D-B: classify update-articles runs from phase status + jobs API + legacy fallback.
 *
 * Canonical status tokens align with scripts/iu_article_pipeline_phase_status.py
 */
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PIPELINE_SUCCESS = "PIPELINE_SUCCESS";
export const INGEST_SUCCESS_RELEASE_BLOCKED = "INGEST_SUCCESS_RELEASE_BLOCKED";
export const RELEASE_FAILED = "RELEASE_FAILED";
export const INGEST_FAILED = "INGEST_FAILED";
export const AGGREGATE_FAILED = "AGGREGATE_FAILED";
export const SKIPPED_DUPLICATE = "SKIPPED_DUPLICATE";
export const RUN_CANCELLED = "RUN_CANCELLED";
export const UNKNOWN_INCOMPLETE = "UNKNOWN_INCOMPLETE";

export const ALERT_GREEN = "GREEN";
export const ALERT_YELLOW = "YELLOW";
export const ALERT_RED = "RED";

const INGEST_OK = "INGEST_OK";
const INGEST_FAIL = "INGEST_FAIL";
const AGGREGATE_OK = "AGGREGATE_OK";
const AGGREGATE_FAIL = "AGGREGATE_FAIL";
const RELEASE_OK = "RELEASE_OK";
export const RELEASE_BLOCKED = "RELEASE_BLOCKED";
const RELEASE_FAIL = "RELEASE_FAIL";
const PUBLISH_OK = "PUBLISH_OK";
const PUBLISH_SKIPPED = "PUBLISH_SKIPPED";
const PUBLISH_FAILED = "PUBLISH_FAILED";

const JOB_INGEST = "article_pipeline_ingest";
const JOB_AGGREGATE = "article_pipeline_aggregate";
const JOB_RELEASE = "article_data_release";
const JOB_GATE = "pipeline_gate";

function jobByName(jobs, name) {
  if (!Array.isArray(jobs)) return null;
  return jobs.find((j) => j && j.name === name) || null;
}

function isLegacyRun(jobs) {
  return jobByName(jobs, JOB_INGEST) == null;
}

function skippedDuplicateFromJobs(jobs) {
  const gate = jobByName(jobs, JOB_GATE);
  const ingest = jobByName(jobs, JOB_INGEST);
  const aggregate = jobByName(jobs, JOB_AGGREGATE);
  if (!gate || !ingest || !aggregate) return false;
  return (
    gate.conclusion === "success" &&
    ingest.conclusion === "skipped" &&
    aggregate.conclusion === "skipped"
  );
}

/**
 * @param {Record<string, unknown>|null|undefined} phaseStatus
 * @param {{ jobs?: Array<{name?: string, conclusion?: string}>, runConclusion?: string, runStatus?: string }} [meta]
 */
export function derivePipelineOverallStatus(phaseStatus, meta = {}) {
  const { jobs = null, runConclusion = "", runStatus = "" } = meta;
  const rc = String(runConclusion || "").toLowerCase();
  const rs = String(runStatus || "").toLowerCase();
  if (rs === "cancelled" || rc === "cancelled") return RUN_CANCELLED;

  if (skippedDuplicateFromJobs(jobs)) return SKIPPED_DUPLICATE;

  if (phaseStatus && typeof phaseStatus === "object") {
    const ingest = phaseStatus.ingest_status;
    const aggregate = phaseStatus.aggregate_status;
    const release = phaseStatus.release_status;
    const publish = phaseStatus.publish_status;
    if (ingest === INGEST_FAIL) return INGEST_FAILED;
    if (aggregate === AGGREGATE_FAIL) return AGGREGATE_FAILED;
    if (ingest === INGEST_OK && aggregate === AGGREGATE_OK) {
      const pool = phaseStatus.clean_pool_status;
      if (release === RELEASE_BLOCKED) return INGEST_SUCCESS_RELEASE_BLOCKED;
      if (release === RELEASE_FAIL || publish === PUBLISH_FAILED) return RELEASE_FAILED;
      if (release === RELEASE_OK && (publish === PUBLISH_OK || publish === PUBLISH_SKIPPED || publish == null)) {
        return PIPELINE_SUCCESS;
      }
      // PUBLISH_ALWAYS: ingest+aggregate+clean pool succeeded; release/publish n/a is not a blocker
      if (pool === "CLEAN_POOL_CREATED" && release == null && publish == null) {
        return PIPELINE_SUCCESS;
      }
    }
  }

  if (Array.isArray(jobs) && jobs.length) {
    const ingestJob = jobByName(jobs, JOB_INGEST);
    const aggregateJob = jobByName(jobs, JOB_AGGREGATE);
    const releaseJob = jobByName(jobs, JOB_RELEASE);
    if (ingestJob?.conclusion === "failure") return INGEST_FAILED;
    if (aggregateJob?.conclusion === "failure") return AGGREGATE_FAILED;
    const ingestOk = ingestJob?.conclusion === "success";
    const aggregateOk = aggregateJob?.conclusion === "success";
    if (ingestOk && aggregateOk) {
      if (!releaseJob || releaseJob.conclusion === "skipped") return UNKNOWN_INCOMPLETE;
      if (releaseJob.conclusion === "success") return PIPELINE_SUCCESS;
      if (releaseJob.conclusion === "failure") return UNKNOWN_INCOMPLETE;
    }
  }

  if (isLegacyRun(jobs)) {
    if (rc === "success") return PIPELINE_SUCCESS;
    if (rc === "failure") return UNKNOWN_INCOMPLETE;
  }

  return UNKNOWN_INCOMPLETE;
}

export function alertLevelForOverallStatus(overall) {
  if (overall === PIPELINE_SUCCESS || overall === SKIPPED_DUPLICATE) return ALERT_GREEN;
  if (overall === INGEST_SUCCESS_RELEASE_BLOCKED) return ALERT_YELLOW;
  return ALERT_RED;
}

export function isIngestAggregateOkStatus(overall) {
  return overall === PIPELINE_SUCCESS || overall === INGEST_SUCCESS_RELEASE_BLOCKED;
}

export function isPipelineFailureStatus(overall) {
  return alertLevelForOverallStatus(overall) === ALERT_RED;
}

export async function ghApi(pathname, token) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "iu-pipeline-run-classifier",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${pathname} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function readPhaseStatusFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Download pipeline-phase-status-{runId} artifact via gh CLI when available.
 */
export function fetchPhaseStatusArtifactSync(owner, repo, runId, token) {
  const artifactName = `pipeline-phase-status-${runId}`;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iu-phase-status-"));
  try {
    execSync(
      `gh run download ${runId} --repo ${owner}/${repo} --name ${artifactName} --dir "${tmpRoot}"`,
      {
        encoding: "utf8",
        env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      },
    );
    const direct = path.join(tmpRoot, "article_pipeline_phase_status.json");
    if (fs.existsSync(direct)) return readPhaseStatusFile(direct);
    const nested = fs
      .readdirSync(tmpRoot, { withFileTypes: true })
      .flatMap((ent) => {
        if (!ent.isDirectory()) return [];
        const p = path.join(tmpRoot, ent.name, "article_pipeline_phase_status.json");
        return fs.existsSync(p) ? [p] : [];
      });
    if (nested.length) return readPhaseStatusFile(nested[0]);
    return null;
  } catch {
    return null;
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export async function fetchRunJobs(owner, repo, runId, token) {
  const data = await ghApi(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=30`, token);
  return data.jobs || [];
}

function needsPhaseStatusArtifact(jobs, overallWithoutArtifact) {
  const ingestJob = jobByName(jobs, JOB_INGEST);
  const aggregateJob = jobByName(jobs, JOB_AGGREGATE);
  const releaseJob = jobByName(jobs, JOB_RELEASE);
  return (
    overallWithoutArtifact === UNKNOWN_INCOMPLETE &&
    ingestJob?.conclusion === "success" &&
    aggregateJob?.conclusion === "success" &&
    releaseJob?.conclusion === "failure"
  );
}

/**
 * Classify one workflow run (live GitHub).
 * @returns {Promise<{ overall: string, alert: string, runId: number|string, phaseStatus: object|null, jobs: array }>}
 */
export async function classifyRunFromGitHub(owner, repo, run, token, { fetchArtifact = true } = {}) {
  const runId = run.id ?? run.databaseId;
  const jobs = await fetchRunJobs(owner, repo, runId, token);
  let phaseStatus = null;
  let overall = derivePipelineOverallStatus(null, {
    jobs,
    runConclusion: run.conclusion,
    runStatus: run.status,
  });

  if (fetchArtifact && needsPhaseStatusArtifact(jobs, overall)) {
    phaseStatus = fetchPhaseStatusArtifactSync(owner, repo, runId, token);
    if (phaseStatus) {
      overall = derivePipelineOverallStatus(phaseStatus, {
        jobs,
        runConclusion: run.conclusion,
        runStatus: run.status,
      });
    }
  }

  return {
    overall,
    alert: alertLevelForOverallStatus(overall),
    runId,
    phaseStatus,
    jobs,
    updatedAt: run.updated_at || run.updatedAt || null,
    createdAt: run.created_at || run.createdAt || null,
  };
}

/**
 * @param {Array<{name?: string, conclusion?: string, started_at?: string, completed_at?: string}>} jobs
 */
export function aggregateJobCompletionMs(jobs, runCreatedAt) {
  const aggregateJob = jobByName(jobs, JOB_AGGREGATE);
  if (aggregateJob?.started_at && aggregateJob?.completed_at) {
    const start = Date.parse(aggregateJob.started_at);
    const end = Date.parse(aggregateJob.completed_at);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return end - start;
    }
  }
  const ingestJob = jobByName(jobs, JOB_INGEST);
  const runStart = Date.parse(runCreatedAt || "");
  const aggEnd = Date.parse(aggregateJob?.completed_at || "");
  if (Number.isFinite(runStart) && Number.isFinite(aggEnd) && aggEnd >= runStart) {
    return aggEnd - runStart;
  }
  if (ingestJob?.started_at && aggregateJob?.completed_at) {
    const start = Date.parse(ingestJob.started_at);
    const end = Date.parse(aggregateJob.completed_at);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return end - start;
    }
  }
  return null;
}

export function ingestAggregateJobsSucceeded(jobs) {
  const ingestJob = jobByName(jobs, JOB_INGEST);
  const aggregateJob = jobByName(jobs, JOB_AGGREGATE);
  return ingestJob?.conclusion === "success" && aggregateJob?.conclusion === "success";
}
