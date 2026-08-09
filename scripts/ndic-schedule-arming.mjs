#!/usr/bin/env node
/**
 * NDIC automatic schedule arming gate (fail-closed, offline-safe pure core).
 *
 * The scheduled path of "Update NDIC DATEX v1" is DISARMED by default: it runs only
 * when the repository variable NDIC_AUTOMATION_ENABLED is exactly 'true'.
 * A second guard skips the run when another run of the same workflow is in progress.
 *
 * Any ambiguity (missing variable, unreadable run list) resolves to "skip with success"
 * so a disarmed or degraded repository never reaches the NDIC network.
 */

export const AUTOMATION_VARIABLE_NAME = "NDIC_AUTOMATION_ENABLED";
export const SCHEDULED_MODE = "active";
export const SKIPPED_MODE = "off";

export const SKIP_NOT_SCHEDULE_EVENT = "NOT_SCHEDULE_EVENT";
export const SKIP_NOT_ARMED = "AUTOMATION_NOT_ARMED";
export const SKIP_INFLIGHT_QUERY_FAILED = "INFLIGHT_QUERY_FAILED";
export const SKIP_DUPLICATE_INFLIGHT = "DUPLICATE_RUN_IN_PROGRESS";

/**
 * Strict arming check. Only the exact literal 'true' (case-insensitive, trimmed) arms
 * automation; '1', 'yes', 'on', 'TRUE!' and missing values stay disarmed.
 * @param {unknown} varsValue
 * @returns {boolean}
 */
export function isAutomationArmed(varsValue) {
  if (typeof varsValue !== "string") return false;
  return varsValue.trim().toLowerCase() === "true";
}

/**
 * Duplicate-inflight decision for the scheduled path.
 * @param {{armed:boolean, inflightCount:number, eventName:string, inflightQueryOk?:boolean}} input
 * @returns {{skip:boolean, reason:string}}
 */
export function shouldSkipSchedule(input) {
  const armed = Boolean(input && input.armed);
  const eventName = String((input && input.eventName) || "");
  const queryOk = input && input.inflightQueryOk === false ? false : true;
  const rawCount = input ? Number(input.inflightCount) : Number.NaN;

  if (eventName !== "schedule") return { skip: true, reason: SKIP_NOT_SCHEDULE_EVENT };
  if (!armed) return { skip: true, reason: SKIP_NOT_ARMED };
  if (!queryOk || !Number.isFinite(rawCount) || rawCount < 0) {
    return { skip: true, reason: SKIP_INFLIGHT_QUERY_FAILED };
  }
  if (rawCount > 0) return { skip: true, reason: SKIP_DUPLICATE_INFLIGHT };
  return { skip: false, reason: "" };
}

/**
 * Resolve the effective NDIC mode. Scheduled runs are ACTIVE only after the armed
 * inline preflight has passed; everything else falls back to the dispatch input.
 * @param {{eventName:string, dispatchMode?:string, proceed?:boolean}} input
 */
export function resolveScheduledMode(input) {
  const eventName = String((input && input.eventName) || "");
  if (eventName === "schedule") {
    return input && input.proceed ? SCHEDULED_MODE : SKIPPED_MODE;
  }
  const dispatchMode = String((input && input.dispatchMode) || "");
  return dispatchMode === "shadow" || dispatchMode === "active" ? dispatchMode : SKIPPED_MODE;
}

/**
 * Full gate evaluation used by the schedule-gate job.
 * @param {{eventName:string, varsValue:unknown, inflightCount:number, inflightQueryOk?:boolean}} input
 */
export function evaluateScheduleGate(input) {
  const armed = isAutomationArmed(input && input.varsValue);
  const decision = shouldSkipSchedule({
    armed,
    eventName: String((input && input.eventName) || ""),
    inflightCount: input ? input.inflightCount : Number.NaN,
    inflightQueryOk: input ? input.inflightQueryOk : true,
  });
  const proceed = !decision.skip;
  return {
    armed,
    proceed,
    skipReason: decision.reason,
    resolvedMode: resolveScheduledMode({
      eventName: String((input && input.eventName) || ""),
      proceed,
    }),
  };
}

/**
 * Count runs of the same workflow that are already in progress, excluding this run.
 * @param {{runs:Array<{id:unknown,status:string}>, selfRunId:string}} input
 */
export function countOtherInflightRuns(input) {
  const runs = Array.isArray(input && input.runs) ? input.runs : [];
  const self = String((input && input.selfRunId) || "");
  return runs.filter((r) => r && String(r.id) !== self && String(r.status) === "in_progress").length;
}

async function fetchInflight({ token, repo, workflowFile, selfRunId }) {
  const url =
    `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/runs` +
    `?status=in_progress&per_page=100`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "iu-ndic-schedule-arming",
    },
  });
  if (!res.ok) return { ok: false, count: 0 };
  const payload = await res.json();
  const runs = Array.isArray(payload && payload.workflow_runs) ? payload.workflow_runs : [];
  return { ok: true, count: countOtherInflightRuns({ runs, selfRunId }) };
}

async function main() {
  const fs = await import("node:fs");
  const eventName = String(process.env.IU_NDIC_SCHEDULE_EVENT_NAME || process.env.GITHUB_EVENT_NAME || "");
  const varsValue = process.env.IU_NDIC_AUTOMATION_ENABLED;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const repo = process.env.GITHUB_REPOSITORY || "";
  const workflowFile = String(process.env.IU_NDIC_SCHEDULE_WORKFLOW_FILE || "update-ndic-datex-v1.yml");
  const selfRunId = String(process.env.IU_NDIC_SCHEDULE_SELF_RUN_ID || process.env.GITHUB_RUN_ID || "");

  const armed = isAutomationArmed(varsValue);
  let inflight = { ok: false, count: 0 };
  if (armed && eventName === "schedule" && token && /^[^/]+\/[^/]+$/.test(repo)) {
    try {
      inflight = await fetchInflight({ token, repo, workflowFile, selfRunId });
    } catch {
      inflight = { ok: false, count: 0 };
    }
  } else if (!armed) {
    // Not armed: the inflight probe result is irrelevant and must not gate the reason.
    inflight = { ok: true, count: 0 };
  }

  const gate = evaluateScheduleGate({
    eventName,
    varsValue,
    inflightCount: inflight.count,
    inflightQueryOk: inflight.ok,
  });

  const out = {
    armed: String(gate.armed),
    proceed: String(gate.proceed),
    skip_reason: gate.skipReason,
    resolved_mode: gate.resolvedMode,
    inflight_other_runs: String(inflight.count),
    automation_variable: AUTOMATION_VARIABLE_NAME,
  };
  console.log(JSON.stringify(out));
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(out)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n"
    );
  }
}

const invokedDirectly =
  process.argv[1] &&
  String(process.argv[1]).replace(/\\/g, "/").endsWith("scripts/ndic-schedule-arming.mjs");
if (invokedDirectly) {
  main().catch((e) => {
    console.error(String(e && e.stack ? e.stack : e));
    process.exit(1);
  });
}
